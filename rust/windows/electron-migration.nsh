; Keep the existing Atoll profile and remove the legacy runtime before installing the Rust host.
; GUID is electron-builder UUID.v5("app.atoll.notch", ELECTRON_BUILDER_NS_UUID).
!define ATOLL_ELECTRON_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\16442ea4-4986-5b15-a1a0-3ab202ec13c2"
!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R8 HKCU "${ATOLL_ELECTRON_KEY}" "InstallLocation"
  ${If} $R8 != ""
    IfFileExists "$APPDATA\Atoll\atoll.pre-rust-install.json" +2 0
      CopyFiles /SILENT "$APPDATA\Atoll\atoll.json" "$APPDATA\Atoll\atoll.pre-rust-install.json"
    IfFileExists "$R8\Uninstall Atoll.exe" 0 atoll_legacy_done
      ExecWait '"$R8\Uninstall Atoll.exe" /S --updated _?=$R8' $R9
      ${If} $R9 != 0
        Abort "The previous Atoll installation could not be closed. Quit Atoll and try again."
      ${EndIf}
    atoll_legacy_done:
  ${EndIf}
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; electron-updater used --force-run; native Tauri updates use /R.
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R9
  ${IfNot} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
  ${EndIf}
!macroend
