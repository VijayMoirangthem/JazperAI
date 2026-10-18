# Usage: scripts\vault_set.ps1 ANTHROPIC_API_KEY   (prompts securely; stores in Windows Credential Manager via core.vault)
param([Parameter(Mandatory)][string]$Name)
$sec = Read-Host -AsSecureString "Value for $Name"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $env:JASPER_VAULT_VALUE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $py = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend\.venv\Scripts\python.exe'
  & $py -c "import os,sys; sys.path.insert(0,'backend/python'); from core import vault; vault.set(sys.argv[1], os.environ['JASPER_VAULT_VALUE'])" $Name
} finally { Remove-Item Env:JASPER_VAULT_VALUE -ErrorAction SilentlyContinue; [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
