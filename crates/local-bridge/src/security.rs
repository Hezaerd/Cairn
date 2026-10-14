use std::{
    env,
    ffi::OsString,
    io, mem,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsRawHandle, RawHandle},
    },
    path::{Path, PathBuf},
    ptr,
};
use tokio::net::windows::named_pipe::{NamedPipeClient, NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, LocalFree},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SE_KERNEL_OBJECT, SetSecurityInfo,
        },
        DACL_SECURITY_INFORMATION, GetSecurityDescriptorDacl, GetTokenInformation,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
        TOKEN_QUERY, TOKEN_USER, TokenUser,
    },
    Storage::FileSystem::{
        CreateFileW, FILE_FLAG_OVERLAPPED, FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_WRITE_DATA,
        OPEN_EXISTING, READ_CONTROL, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT,
        SYNCHRONIZE,
    },
    System::{
        Pipes::GetNamedPipeServerProcessId,
        RemoteDesktop::ProcessIdToSessionId,
        Threading::{
            GetCurrentProcess, GetCurrentProcessId, OpenProcess, OpenProcessToken,
            PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
        },
    },
};

/// What a client may do with the pipe. It leaves out FILE_CREATE_PIPE_INSTANCE,
/// which shares its bit with FILE_APPEND_DATA, so GENERIC_WRITE can be neither
/// granted nor requested.
const CLIENT_ACCESS: u32 =
    FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE;

/// The desktop app's executable, as Cargo and the installer name it.
const APP_EXE: &str = "cairn-desktop.exe";

pub fn identity() -> io::Result<(String, u32)> {
    // Token storage is pointer-aligned for TOKEN_USER. All handles and strings
    // allocated by Windows are freed before returning, including error paths.
    unsafe {
        let mut token = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let result = (|| {
            let mut size = 0;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut size);
            if size == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut buffer = vec![0usize; (size as usize).div_ceil(mem::size_of::<usize>())];
            if GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let user = &*(buffer.as_ptr().cast::<TOKEN_USER>());
            let mut sid = ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut sid) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut len = 0;
            while *sid.add(len) != 0 {
                len += 1;
            }
            let sid_string = String::from_utf16_lossy(std::slice::from_raw_parts(sid, len));
            LocalFree(sid.cast());
            let mut session = 0;
            if ProcessIdToSessionId(GetCurrentProcessId(), &mut session) == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok((sid_string, session))
        })();
        CloseHandle(token);
        result
    }
}

/// A security descriptor parsed from SDDL, freed on drop.
struct Descriptor(PSECURITY_DESCRIPTOR);

impl Descriptor {
    fn new(sddl: &str) -> io::Result<Self> {
        let sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
        let mut descriptor = ptr::null_mut();
        // 1 is SDDL_REVISION_1.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(descriptor))
    }
}

impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

/// Creates every instance the app will serve, then locks the pipe so nobody
/// can add one: `max_instances` makes another instance fail with
/// ERROR_PIPE_BUSY, and the final DACL denies the right to create one. The app
/// loses that right too, so it reuses its instances. If another process holds
/// the name, or adds an instance while the pool is built, this fails instead of
/// sharing the pipe.
pub fn create_pool(name: &str, count: usize) -> io::Result<Vec<NamedPipeServer>> {
    let (sid, _) = identity()?;
    // Protected DACL: only this user. Remote clients are rejected separately.
    let building = Descriptor::new(&format!("D:P(A;;GA;;;{sid})"))?;
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: building.0,
        bInheritHandle: 0,
    };
    let mut pool = Vec::with_capacity(count);
    for index in 0..count {
        let first = index == 0;
        let server = unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .write_dac(first)
                .max_instances(count)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    name,
                    (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
                )?
        };
        pool.push(server);
    }
    // OWNER RIGHTS replaces the owner's implicit READ_CONTROL and WRITE_DAC,
    // so a process running as this user can't rewrite the DACL either.
    let locked = Descriptor::new(&format!(
        "D:P(A;;{CLIENT_ACCESS:#x};;;{sid})(A;;{CLIENT_ACCESS:#x};;;OW)"
    ))?;
    unsafe {
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl = ptr::null_mut();
        if GetSecurityDescriptorDacl(locked.0, &mut present, &mut dacl, &mut defaulted) == 0 {
            return Err(io::Error::last_os_error());
        }
        let error = SetSecurityInfo(
            pool[0].as_raw_handle(),
            SE_KERNEL_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            dacl,
            ptr::null(),
        );
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error as i32));
        }
    }
    Ok(pool)
}

/// Connects to the pipe and checks that the desktop app serves it before
/// anything is written. Another process running as this user could have
/// created the pipe before Cairn started.
pub fn open_client(name: &str) -> io::Result<NamedPipeClient> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            CLIENT_ACCESS,
            0,
            ptr::null(),
            OPEN_EXISTING,
            // Identification only: the server can't act as this user.
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // The client owns the handle from here, so every return closes it.
    let client = unsafe { NamedPipeClient::from_raw_handle(handle as RawHandle)? };
    let image = server_image(handle)?;
    let host = env::current_exe()?;
    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    if !trusted_server(
        &image,
        &host,
        local_app_data.as_deref(),
        cfg!(debug_assertions),
    ) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "the pipe server isn't Cairn",
        ));
    }
    Ok(client)
}

fn server_image(pipe: HANDLE) -> io::Result<PathBuf> {
    unsafe {
        let mut pid = 0;
        if GetNamedPipeServerProcessId(pipe, &mut pid) == 0 {
            return Err(io::Error::last_os_error());
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0u16; 32_768];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
        let error = io::Error::last_os_error();
        CloseHandle(process);
        if ok == 0 {
            return Err(error);
        }
        Ok(OsString::from_wide(&buffer[..size as usize]).into())
    }
}

/// The server must be `cairn-desktop.exe` beside the native host, as in a
/// build, or in the installer's default folder. Debug builds also accept any
/// executable under the host's folder, where Cargo puts test binaries.
fn trusted_server(image: &Path, host: &Path, local_app_data: Option<&Path>, debug: bool) -> bool {
    let normalize = |path: &Path| {
        let path = std::fs::canonicalize(path).ok()?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        Some(String::from_utf16_lossy(&wide).to_lowercase())
    };
    let (Some(image), Some(folder)) = (normalize(image), host.parent().and_then(normalize)) else {
        return false;
    };
    if debug && image.starts_with(&format!("{folder}\\")) {
        return true;
    }
    let mut expected = vec![host.with_file_name(APP_EXE)];
    if let Some(local_app_data) = local_app_data {
        expected.push(local_app_data.join("Cairn").join(APP_EXE));
    }
    expected
        .iter()
        .any(|path| normalize(path).as_ref() == Some(&image))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn trusts_only_the_app_beside_the_host_or_installed() {
        let root = env::temp_dir().join(format!("cairn-trust-{}", std::process::id()));
        let build = root.join("build");
        let installed = root.join("local").join("Cairn");
        let tests = build.join("deps");
        for folder in [&build, &installed, &tests] {
            fs::create_dir_all(folder).unwrap();
        }
        let host = build.join("cairn-native-host.exe");
        for file in [
            host.clone(),
            build.join(APP_EXE),
            build.join("other.exe"),
            installed.join(APP_EXE),
            tests.join("bridge.exe"),
            root.join(APP_EXE),
        ] {
            fs::write(file, b"").unwrap();
        }
        let local = root.join("local");
        let trusted = |image: PathBuf, debug| trusted_server(&image, &host, Some(&local), debug);

        assert!(trusted(build.join(APP_EXE), false));
        assert!(trusted(build.join("CAIRN-DESKTOP.EXE"), false));
        assert!(trusted(installed.join(APP_EXE), false));
        assert!(!trusted(build.join("other.exe"), false));
        assert!(!trusted(root.join(APP_EXE), false));
        assert!(!trusted(tests.join("bridge.exe"), false));
        assert!(trusted(tests.join("bridge.exe"), true));
        assert!(!trusted(root.join(APP_EXE), true));
        assert!(!trusted(build.join("missing.exe"), true));
        fs::remove_dir_all(root).unwrap();
    }
}
