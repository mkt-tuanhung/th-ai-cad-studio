; Inno Setup script — TH AI CAD Studio for Windows (x64). Built by build_windows.ps1.
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\dist-win\TH AI CAD Studio"
#endif

[Setup]
AppId={{7E1B6C1E-5C2B-4C1A-9F4E-3A1D2B7C9E10}
AppName=TH AI CAD Studio
AppVersion={#AppVersion}
AppPublisher=TH
DefaultDirName={autopf}\TH AI CAD Studio
DefaultGroupName=TH AI CAD Studio
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputBaseFilename=TH-AI-CAD-Studio-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\TH AI CAD Studio.exe
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "vi"; MessagesFile: "compiler:Languages\Vietnamese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; local AI models live per user: %LOCALAPPDATA%\TH AI CAD Studio\models (never in Program Files)
Name: "{localappdata}\TH AI CAD Studio\models"

[Icons]
Name: "{group}\TH AI CAD Studio"; Filename: "{app}\TH AI CAD Studio.exe"
Name: "{autodesktop}\TH AI CAD Studio"; Filename: "{app}\TH AI CAD Studio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TH AI CAD Studio.exe"; Description: "{cm:LaunchProgram,TH AI CAD Studio}"; Flags: nowait postinstall skipifsilent
