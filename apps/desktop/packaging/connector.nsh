!define CAIRN_HOST_KEY "Software\Chromium\NativeMessagingHosts\com.hezaerd.cairn"

!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\extension"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetRegView 32
  WriteRegStr HKCU "${CAIRN_HOST_KEY}" "" "$INSTDIR\cairn-native-host.json"
  SetRegView 64
  WriteRegStr HKCU "${CAIRN_HOST_KEY}" "" "$INSTDIR\cairn-native-host.json"
  SetRegView default
!macroend

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
