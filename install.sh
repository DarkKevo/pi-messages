#!/usr/bin/env bash
# ==============================================================================
# pi-messages installer
# https://github.com/DarkKevo/pi-messages
# ==============================================================================

set -e

REPO_NAME="DarkKevo/pi-messages"
RAW_URL="https://raw.githubusercontent.com/${REPO_NAME}/main/pi-messages.ts"
EXT_DIR="${HOME}/.pi/agent/extensions"
TARGET_FILE="${EXT_DIR}/pi-messages.ts"

# Colors
BOLD="\033[1m"
GREEN="\033[38;2;120;220;120m"
CYAN="\033[38;2;140;200;250m"
YELLOW="\033[38;2;250;210;100m"
DIM="\033[38;2;140;140;140m"
RESET="\033[0m"

echo -e "\n${BOLD}${CYAN}╭──────────────────────────────────────────╮${RESET}"
echo -e "${BOLD}${CYAN}│        Instalador de pi-messages 🎨      │${RESET}"
echo -e "${BOLD}${CYAN}╰──────────────────────────────────────────╯${RESET}\n"

# 1. Asegurar directorio de extensiones
mkdir -p "$EXT_DIR"

# 2. Determinar si se corre desde un clon local o vía curl | bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

if [[ -f "${SCRIPT_DIR}/pi-messages.ts" ]]; then
    echo -e "${DIM}▸ Detectado repositorio local en: ${SCRIPT_DIR}${RESET}"
    echo -e "${DIM}▸ Creando enlace simbólico (symlink)...${RESET}"
    ln -sf "${SCRIPT_DIR}/pi-messages.ts" "$TARGET_FILE"
    echo -e "${GREEN}✓ Enlace simbólico creado en:${RESET} ${TARGET_FILE}"
else
    echo -e "${DIM}▸ Descargando pi-messages.ts desde GitHub...${RESET}"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$RAW_URL" -o "$TARGET_FILE"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$TARGET_FILE" "$RAW_URL"
    else
        echo -e "${YELLOW}✗ Error: Se requiere curl o wget para descargar la extensión.${RESET}"
        exit 1
    fi
    echo -e "${GREEN}✓ Archivo descargado en:${RESET} ${TARGET_FILE}"
fi

# 3. Verificación de portapapeles en Linux
if [[ "$(uname -s)" == "Linux" ]]; then
    if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
        if ! command -v wl-copy >/dev/null 2>&1; then
            echo -e "\n${YELLOW}⚠ Tip (Wayland): No se detectó 'wl-clipboard'.${RESET}"
            echo -e "  Instalalo con tu gestor de paquetes (ej: sudo pacman -S wl-clipboard / sudo apt install wl-clipboard) para habilitar el copiado al portapapeles."
        fi
    else
        if ! command -v xclip >/dev/null 2>&1 && ! command -v xsel >/dev/null 2>&1; then
            echo -e "\n${YELLOW}⚠ Tip (X11): No se detectó 'xclip' ni 'xsel'.${RESET}"
            echo -e "  Instalalo para habilitar el copiado al portapapeles."
        fi
    fi
fi

# 4. Mensaje de éxito
echo -e "\n${BOLD}${GREEN}🎉 ¡pi-messages instalado correctamente!${RESET}\n"
echo -e "Para activarlo:"
echo -e "  ${BOLD}1.${RESET} Si ya tenés una sesión de Pi abierta: ejecutá ${CYAN}/reload${RESET}"
echo -e "  ${BOLD}2.${RESET} O iniciá una nueva sesión con ${CYAN}pi${RESET}\n"
echo -e "${DIM}Atajos rápidos: Alt+C (/cc) para copiar código, Alt+I (/ci) para insertar en el prompt.${RESET}\n"
