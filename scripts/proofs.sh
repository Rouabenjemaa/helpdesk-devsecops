#!/usr/bin/env bash
# Phase 1 : rejoue les preuves "AVANT correction" (à photographier pour le rapport).
# Prérequis : base + backend lancés (npm start).  Usage : bash scripts/proofs.sh
# Cible UNIQUEMENT votre application locale.
API="${API:-http://localhost:3000/api}"
login() { curl -s -X POST "$API/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"$1\",\"password\":\"Passw0rd!\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/'; }

T_ROUA=$(login roua)

echo "=== VULN-001 : injection SQL (roua ne devrait voir que ses tickets) ==="
echo "--- recherche normale 'VPN' :"
curl -s -G "$API/search" --data-urlencode "q=VPN" -H "Authorization: Bearer $T_ROUA"; echo
echo "--- payload ' OR 1=1 -- :"
curl -s -G "$API/search" --data-urlencode "q=' OR 1=1 --" -H "Authorization: Bearer $T_ROUA"; echo

echo; echo "=== VULN-003 : IDOR (roua lit le ticket #3 de mahdi) ==="
curl -s -i "$API/tickets/3" -H "Authorization: Bearer $T_ROUA" | head -n 1
curl -s "$API/tickets/3" -H "Authorization: Bearer $T_ROUA"; echo

echo; echo "=== VULN-002 : XSS stocké (le commentaire est enregistré tel quel) ==="
curl -s -X POST "$API/tickets/1/comments" -H "Authorization: Bearer $T_ROUA" -H "Content-Type: application/json" \
  -d '{"body":"<img src=x onerror=\"alert(1)\">"}'; echo
echo "Ouvrez http://localhost:3000, connectez-vous en agent1, ouvrez le ticket #1 : alert(1) s'exécute."

echo; echo "=== VULN-004 : secret JWT codé en dur ==="
grep -n "VULNERABLE_JWT_SECRET =" "$(dirname "$0")/../backend/server.js"
