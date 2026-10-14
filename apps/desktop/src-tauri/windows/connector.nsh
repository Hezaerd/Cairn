; Registers the bundled native host for Helium. Chromium's Windows lookup
; checks this key, then Google\Chrome; Helium keeps that lookup. Both registry
; views are written so neither shadows the other, like the dev scripts do.
!define CAIRN_HOST_KEY "Software\Chromium\NativeMessagingHosts\com.hezaerd.cairn"

!macro NSIS_HOOK_PREINSTALL
  ; Popup chunks have hashed names, so clear the old copy instead of piling up files.
  RMDir /r "$INSTDIR\extension"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 32
  WriteRegStr HKCU "${CAIRN_HOST_KEY}" "" "$INSTDIR\cairn-native-host.json"
  SetRegView 64
  WriteRegStr HKCU "${CAIRN_HOST_KEY}" "" "$INSTDIR\cairn-native-host.json"
  SetRegView default
!macroend

; An update's uninstall runs before the new files are copied, and the
; post-install hook registers the host again.
!macro CAIRN_REMOVE_HOST_KEY
  ReadRegStr $R7 HKCU "${CAIRN_HOST_KEY}" ""
  ${If} $R7 == "$INSTDIR\cairn-native-host.json"
    DeleteRegKey HKCU "${CAIRN_HOST_KEY}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetRegView 32
  !insertmacro CAIRN_REMOVE_HOST_KEY
  SetRegView 64
  !insertmacro CAIRN_REMOVE_HOST_KEY
  SetRegView default
!macroend
