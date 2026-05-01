@echo off
setlocal
if exist "certs\russian_trusted_root_ca_pem.crt" (
  set "NODE_EXTRA_CA_CERTS=%CD%\certs\russian_trusted_root_ca_pem.crt"
  echo Using certificate: %NODE_EXTRA_CA_CERTS%
) else (
  echo Certificate file not found in certs\.
)
npm start
pause
