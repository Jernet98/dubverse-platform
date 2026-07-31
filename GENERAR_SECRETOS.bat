@echo off
powershell -NoProfile -Command "$a=New-Object byte[] 36; [Security.Cryptography.RandomNumberGenerator]::Fill($a); $b=New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Fill($b); Write-Host ''; Write-Host 'ADMIN_ACCESS_KEY='([Convert]::ToBase64String($a).Replace('+','-').Replace('/','_').TrimEnd('=')); Write-Host ''; Write-Host 'AUTH_SECRET='([Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')); Write-Host ''"
pause
