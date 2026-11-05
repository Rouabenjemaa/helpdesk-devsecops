# Comparaison ZAP : avant et apres correction

| Niveau | Alerte | Avant | Apres | Etat |
|---|---|---|---|---|
| High | SQL Injection | 1 | 0 | CORRIGEE |
| Medium | Content Security Policy (CSP) Header Not Set | 4 | 0 | CORRIGEE |
| Medium | CSP: script-src unsafe-inline | 0 | 4 | NOUVELLE |
| Medium | CSP: style-src unsafe-inline | 0 | 4 | NOUVELLE |
| Medium | Missing Anti-clickjacking Header | 4 | 0 | CORRIGEE |
| Low | A Server Error response code was returned by the server | 4 | 4 | PRESENTE |
| Low | Cross-Origin-Embedder-Policy Header Missing or Invalid | 4 | 3 | PRESENTE |
| Low | Cross-Origin-Opener-Policy Header Missing or Invalid | 4 | 3 | PRESENTE |
| Low | Cross-Origin-Resource-Policy Header Missing or Invalid | 9 | 8 | PRESENTE |
| Low | Permissions Policy Header Not Set | 4 | 4 | PRESENTE |
| Low | Private IP Disclosure | 3 | 3 | PRESENTE |
| Low | Server Leaks Information via "X-Powered-By" HTTP Response Header Field(s) | 5 | 0 | CORRIGEE |
| Low | Server Leaks Version Information via "Server" HTTP Response Header Field | 9 | 0 | CORRIGEE |
| Low | Unexpected Content-Type was returned | 19 | 19 | PRESENTE |
| Low | X-Content-Type-Options Header Missing | 9 | 0 | CORRIGEE |
| Informational | A Client Error response code was returned by the server | 20 | 22 | PRESENTE |
| Informational | Authentication Request Identified | 1 | 1 | PRESENTE |
| Informational | Information Disclosure - Suspicious Comments | 6 | 4 | PRESENTE |
| Informational | Modern Web Application | 4 | 4 | PRESENTE |
| Informational | Non-Storable Content | 5 | 5 | PRESENTE |
| Informational | Storable and Cacheable Content | 4 | 4 | PRESENTE |
