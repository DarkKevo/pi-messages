/**
 * pi-messages Extension for Pi
 *
 * Transforma los bloques de código de Markdown en tarjetas de terminal estilizadas:
 * - Cabecera simétrica con icono Nerd Font del lenguaje y nombre de archivo (╭─ ... ─╮).
 * - Minileyenda "/cc" en la cabecera indicando el comando rápido de copiado.
 * - Fondo integrado con el tema activo (toolSuccessBg) con alpha blending al 50%.
 * - Líneas de código con sangría, fondo continuo y soft-wrap inteligente (sin barras │ ni truncado con …).
 * - Borde inferior redondeado simétrico (╰─ ... ─╯).
 * - Slash commands /cc y /copy-code con selector interactivo y opción /cc all (excluyendo diffs).
 * - Atajo de teclado global Alt+C para copiar código al instante.
 * - Slash commands /ci y /insert-code con pegado nativo pasteToEditor ([paste #N +X lines]).
 * - Atajo de teclado global Alt+I para insertar código en el editor de Pi al instante.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PATCH_KEY = Symbol.for("pi.codeblock_cards_patched");

// Fallback por defecto si aún no cargó el tema interactivo (Gentleman-Cute)
const DEFAULT_BG = "\x1b[48;2;21;19;22m";     // #151316 (toolSuccessBg)
const DEFAULT_BORDER = "\x1b[38;2;86;48;64m"; // #563040 (border)
const DEFAULT_TAG = "\x1b[38;2;240;149;200m"; // #F095C8 (accent)
const DEFAULT_MUTED = "\x1b[38;2;120;100;110m";

const RESET_FG = "\x1b[39m";
const RESET_BG = "\x1b[49m";
const RESET_ALL = "\x1b[0m";

// Factor de opacidad: 0.50 = 50% de opacidad (más sutil y translúcido sobre el fondo)
const CARD_OPACITY = 0.50;

let activeUiTheme: any = null;

// Configuración persistente del motor de color
type SyntaxEngineMode = "picolor" | "vanilla";
const CONFIG_PATH = `${process.env.HOME || ""}/.pi/agent/pi-messages.json`;

function loadSyntaxMode(): SyntaxEngineMode {
	try {
		const fs = require("fs");
		if (fs.existsSync(CONFIG_PATH)) {
			const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
			if (data && (data.syntaxEngine === "vanilla" || data.syntaxEngine === "picolor")) {
				return data.syntaxEngine;
			}
		}
	} catch {}
	return "picolor";
}

function saveSyntaxMode(mode: SyntaxEngineMode) {
	try {
		const fs = require("fs");
		const path = require("path");
		const dir = path.dirname(CONFIG_PATH);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: !0 });
		fs.writeFileSync(CONFIG_PATH, JSON.stringify({ syntaxEngine: mode }, null, 2), "utf8");
	} catch {}
}

let activeSyntaxMode: SyntaxEngineMode = loadSyntaxMode();

// Mapa de iconos Nerd Font por lenguaje/formato
const LANG_ICONS: Record<string, string> = {
	// TypeScript / JavaScript
	ts: "",
	typescript: "",
	tsx: "",
	mts: "",
	cts: "",
	js: "",
	javascript: "",
	jsx: "",
	mjs: "",
	cjs: "",

	// Go
	go: "",
	golang: "",

	// Rust
	rs: "",
	rust: "",

	// Python
	py: "",
	python: "",

	// Ruby
	rb: "",
	ruby: "",

	// JVM
	java: "",
	kt: "󱈙",
	kotlin: "󱈙",
	scala: "",
	groovy: "",

	// C / C++ / C#
	c: "",
	h: "",
	cpp: "",
	cxx: "",
	cc: "",
	hpp: "",
	cs: "󰌛",
	csharp: "󰌛",
	dotnet: "󰌛",

	// PHP
	php: "",

	// Shells / Terminal
	sh: "",
	bash: "",
	zsh: "",
	shell: "",
	fish: "",
	powershell: "󰨊",
	ps1: "󰨊",
	console: "",
	terminal: "",

	// Web / Estilos
	html: "",
	css: "",
	scss: "",
	sass: "",
	less: "",

	// Formatos de datos y configs
	json: "󰘦",
	jsonc: "󰘦",
	yaml: "󰘦",
	yml: "󰘦",
	toml: "󰘦",
	xml: "󰗀",
	graphql: "󱈢",
	proto: "󰘦",
	protobuf: "󰘦",

	// DevOps / Build
	dockerfile: "󰡨",
	docker: "󰡨",
	makefile: "",
	make: "",

	// Diffs, parches y git
	diff: "",
	patch: "",
	git: "",
	gitcommit: "",
	gitrebase: "",

	// Base de datos
	sql: "",
	pgsql: "",
	mysql: "",
	plsql: "",

	// Lenguajes modernos & funcionales
	lua: "",
	zig: "",
	swift: "",
	dart: "",
	elixir: "",
	erlang: "",
	clojure: "",
	haskell: "",
	solidity: "󰡪",
	sol: "󰡪",

	// Data science / Otros
	r: "󰟔",
	matlab: "󰮔",
	perl: "",
	nim: "",
	v: "",

	// Texto plano y logs
	text: "󰌠",
	txt: "󰌠",
	plain: "󰌠",
	plaintext: "󰌠",
	log: "󰌠",
	logs: "󰌠",
};

// Lista de formatos admitidos para tarjetas
const ALLOWED_LANGUAGES = new Set([
	"",
	...Object.keys(LANG_ICONS),
]);

function blendWithBackground(colorAnsi: string, opacity: number = CARD_OPACITY): string {
	const match = colorAnsi.match(/48;2;(\d+);(\d+);(\d+)m/);
	if (!match) return colorAnsi;

	const r = parseInt(match[1], 10);
	const g = parseInt(match[2], 10);
	const b = parseInt(match[3], 10);

	// Fondo base de la terminal (#060407 en Gentleman-Cute)
	const baseR = 6;
	const baseG = 4;
	const baseB = 7;

	const blendedR = Math.round(r * opacity + baseR * (1 - opacity));
	const blendedG = Math.round(g * opacity + baseG * (1 - opacity));
	const blendedB = Math.round(b * opacity + baseB * (1 - opacity));

	return `\x1b[48;2;${blendedR};${blendedG};${blendedB}m`;
}

function resolveColors() {
	let bgAnsi = DEFAULT_BG;
	let borderAnsi = DEFAULT_BORDER;
	let tagAnsi = DEFAULT_TAG;
	let mutedAnsi = DEFAULT_MUTED;

	if (activeUiTheme) {
		try {
			bgAnsi = activeUiTheme.getBgAnsi("toolSuccessBg");
		} catch {
			try {
				bgAnsi = activeUiTheme.getBgAnsi("userMessageBg");
			} catch {
				bgAnsi = DEFAULT_BG;
			}
		}

		try {
			borderAnsi = activeUiTheme.getFgAnsi("border");
		} catch {
			try {
				borderAnsi = activeUiTheme.getFgAnsi("borderMuted");
			} catch {
				borderAnsi = DEFAULT_BORDER;
			}
		}

		try {
			tagAnsi = activeUiTheme.getFgAnsi("accent");
		} catch {
			tagAnsi = DEFAULT_TAG;
		}

		try {
			mutedAnsi = activeUiTheme.getFgAnsi("textMuted");
		} catch {
			try {
				mutedAnsi = activeUiTheme.getFgAnsi("borderMuted");
			} catch {
				mutedAnsi = DEFAULT_MUTED;
			}
		}
	}

	// Atenuamos el fondo según CARD_OPACITY hacia el fondo de la pantalla
	bgAnsi = blendWithBackground(bgAnsi, CARD_OPACITY);

	return { bgAnsi, borderAnsi, tagAnsi, mutedAnsi };
}

/**
 * Parsea el encabezado de un bloque de código Markdown para extraer:
 * - lenguaje base (para syntax highlighting)
 * - título visible (nombre de archivo si fue provisto, o nombre de lenguaje)
 * - glifo/icono de Nerd Font
 */
function parseHeader(rawHeader: string): { lang: string; displayTitle: string; icon: string } {
	const trimmed = (rawHeader || "").trim();
	if (!trimmed) {
		return { lang: "", displayTitle: "", icon: "󰌠" };
	}

	let lang = "";
	let filename = "";

	if (trimmed.includes(":")) {
		const parts = trimmed.split(":");
		lang = parts[0].trim().toLowerCase();
		filename = parts.slice(1).join(":").trim();
	} else if (/filename=["']?([^"'\s]+)["']?/.test(trimmed)) {
		const match = trimmed.match(/filename=["']?([^"'\s]+)["']?/);
		filename = match ? match[1] : "";
		lang = trimmed.split(/\s+/)[0].trim().toLowerCase();
	} else if (/title=["']?([^"'\s]+)["']?/.test(trimmed)) {
		const match = trimmed.match(/title=["']?([^"'\s]+)["']?/);
		filename = match ? match[1] : "";
		lang = trimmed.split(/\s+/)[0].trim().toLowerCase();
	} else if (trimmed.includes(" ")) {
		const parts = trimmed.split(/\s+/);
		lang = parts[0].trim().toLowerCase();
		filename = parts.slice(1).join(" ").trim();
	} else {
		// Chequear si el encabezado es directamente un nombre de archivo (ej: main.go, Dockerfile)
		if (trimmed.includes(".") && !LANG_ICONS[trimmed.toLowerCase()]) {
			filename = trimmed;
			lang = trimmed.split(".").pop()?.toLowerCase() || "";
		} else {
			lang = trimmed.toLowerCase();
		}
	}

	const icon = LANG_ICONS[lang] || (filename ? (LANG_ICONS[filename.split(".").pop()?.toLowerCase() || ""] || "󰅪") : "󰅪");
	const displayTitle = filename || lang;

	return { lang, displayTitle, icon };
}

/**
 * Extrae los bloques de código de un texto Markdown
 */
function extractCodeBlocks(markdown: string): Array<{ lang: string; title: string; code: string }> {
	const blocks: Array<{ lang: string; title: string; code: string }> = [];
	const regex = /```([^\n]*)\n([\s\S]*?)```/g;
	let match;

	while ((match = regex.exec(markdown)) !== null) {
		const rawHeader = (match[1] || "").trim();
		const code = match[2].replace(/\r\n/g, "\n").replace(/\n$/, "");
		const { lang, displayTitle } = parseHeader(rawHeader);
		blocks.push({ lang, title: displayTitle, code });
	}

	return blocks;
}

/**
 * ============================================================================
 * MOTOR DE RESALTADO SEMÁNTICO UNIVERSAL DINÁMICO (Multi-Lenguaje y Multi-Tema)
 * ============================================================================
 * Combina la base de gramáticas oficial de highlight.js (más de 190 lenguajes)
 * con un analizador de enriquecimiento AST de alta fidelidad que rescata:
 * - Llamadas a métodos y funciones (.Method(), callFunc())
 * - Clases, Structs y Tipos de datos en PascalCase
 * - Operadores universales (:=, !=, ==, ===, !==, <=, >=, &&, ||, ->, =>, <-, etc.)
 * Y traduce todo en tiempo real al mapa ANSI del tema activo en Pi.
 */

interface SyntaxPalette {
	keyword: string;
	fn: string;
	type: string;
	string: string;
	number: string;
	comment: string;
	operator: string;
	punctuation: string;
	variable: string;
	text: string;
	resetFg: string;
}

function getThemeSyntaxColors(theme?: any): SyntaxPalette {
	const t = theme || activeUiTheme;
	const safeFg = (key: string, fallback: string): string => {
		if (!t) return fallback;
		try {
			return t.getFgAnsi(key);
		} catch {
			return fallback;
		}
	};

	const textFg = safeFg("text", "\x1b[38;2;246;239;243m");
	let variableFg = safeFg("syntaxVariable", textFg);

	// Si el tema tiene syntaxVariable mapeado al mismo color que el texto base,
	// usamos un color armónico del tema para dar contraste y jerarquía.
	if (variableFg === textFg) {
		variableFg = safeFg("softRose", safeFg("accent", "\x1b[38;2;240;149;200m"));
	}

	return {
		keyword: safeFg("syntaxKeyword", "\x1b[38;2;191;15;80m"),
		fn: safeFg("syntaxFunction", "\x1b[38;2;196;155;255m"),
		type: safeFg("syntaxType", "\x1b[38;2;169;199;238m"),
		string: safeFg("syntaxString", "\x1b[38;2;224;194;122m"),
		number: safeFg("syntaxNumber", "\x1b[38;2;215;160;184m"),
		comment: safeFg("syntaxComment", "\x1b[38;2;167;142;155m"),
		operator: safeFg("syntaxOperator", "\x1b[38;2;255;79;154m"),
		punctuation: safeFg("syntaxPunctuation", "\x1b[38;2;167;142;155m"),
		variable: variableFg,
		text: textFg,
		resetFg: RESET_FG,
	};
}

let cachedHljs: any = null;

function getHljs(): any {
	if (cachedHljs) return cachedHljs;

	const path = require("path");
	const fs = require("fs");

	const candidates = [
		"highlight.js",
		path.join(process.env.HOME || "", ".npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/highlight.js"),
		path.join(process.env.HOME || "", ".npm-global/lib/node_modules/highlight.js"),
		"/usr/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/highlight.js",
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/highlight.js",
	];

	try {
		const which = require("child_process").execSync("which pi 2>/dev/null").toString().trim();
		if (which) {
			const realPi = fs.realpathSync(which);
			const piDir = path.dirname(realPi);
			candidates.push(path.join(piDir, "../node_modules/highlight.js"));
			candidates.push(path.join(piDir, "node_modules/highlight.js"));
		}
	} catch {}

	for (const candidate of candidates) {
		try {
			cachedHljs = require(candidate);
			if (cachedHljs && typeof cachedHljs.highlight === "function") {
				return cachedHljs;
			}
		} catch {}
	}

	return null;
}

/**
 * Convierte el HTML generado por highlight.js enriquecido en secuencias ANSI de terminal
 * utilizando los colores exactos del tema activo de Pi.
 */
function renderHtmlToAnsi(html: string, pal: SyntaxPalette): string {
	const stack: string[] = [];
	let out = "";
	const tagRegex = /(<\/?span[^>]*>)|(&amp;|&lt;|&gt;|&quot;|&#x27;)|([^<&]+)/g;
	let m: RegExpExecArray | null;

	while ((m = tagRegex.exec(html)) !== null) {
		const [, tag, entity, text] = m;
		if (tag) {
			if (tag.startsWith("</")) {
				stack.pop();
				const prev = stack.length > 0 ? stack[stack.length - 1] : pal.text;
				out += `${pal.resetFg}${prev}`;
			} else {
				const classMatch = tag.match(/class="([^"]+)"/);
				const cls = classMatch ? classMatch[1] : "";
				let color = pal.text;
				if (cls.includes("hljs-keyword")) color = pal.keyword;
				else if (cls.includes("hljs-title") || cls.includes("hljs-function")) color = pal.fn;
				else if (cls.includes("hljs-string")) color = pal.string;
				else if (cls.includes("hljs-number")) color = pal.number;
				else if (cls.includes("hljs-comment") || cls.includes("hljs-doctag")) color = pal.comment;
				else if (cls.includes("hljs-built_in") || cls.includes("hljs-type") || cls.includes("hljs-class")) color = pal.type;
				else if (cls.includes("hljs-literal")) color = pal.number;
				else if (cls.includes("hljs-params") || cls.includes("hljs-variable") || cls.includes("hljs-attr")) color = pal.variable;
				else if (cls.includes("hljs-operator")) color = pal.operator;
				else if (cls.includes("hljs-punctuation") || cls.includes("hljs-tag")) color = pal.punctuation;

				stack.push(color);
				out += color;
			}
		} else if (entity) {
			if (entity === "&amp;") out += "&";
			else if (entity === "&lt;") out += "<";
			else if (entity === "&gt;") out += ">";
			else if (entity === "&quot;") out += '"';
			else if (entity === "&#x27;") out += "'";
		} else if (text) {
			out += text;
		}
	}

	return out;
}

/**
 * Resalta código usando highlight.js con enriquecimiento semántico universal
 * (detecta llamadas a métodos, clases, punteros y operadores que highlight.js deja en blanco).
 */
function highlightCodeSmart(rawCode: string, rawLang: string, uiTheme: any): string[] {
	const pal = getThemeSyntaxColors(uiTheme);
	const hljs = getHljs();

	let html = "";
	const lang = (rawLang || "").trim().toLowerCase();

	if (hljs) {
		try {
			const validLang = lang && hljs.getLanguage(lang) ? lang : null;
			if (validLang) {
				html = hljs.highlight(rawCode, { language: validLang, ignoreIllegals: true }).value;
			} else {
				html = hljs.highlightAuto(rawCode).value;
			}
		} catch {
			html = "";
		}
	}

	// Si no obtuvimos HTML de hljs, fallback al highlighter nativo de Pi
	if (!html) {
		if (uiTheme && typeof uiTheme.highlightCode === "function") {
			return uiTheme.highlightCode(rawCode, rawLang);
		}
		return rawCode.split("\n");
	}

	// Enriquecimiento semántico universal sobre las zonas de texto plano:
	// Partimos respetando los spans ya reconocidos por highlight.js para no alterar strings ni comentarios
	const tokens = html.split(/(<\/?span[^>]*>)/g);
	let enrichedHtml = "";
	let insideExcluded = false;

	for (const tok of tokens) {
		if (tok.startsWith("<span")) {
			if (
				tok.includes("hljs-string") ||
				tok.includes("hljs-comment") ||
				tok.includes("hljs-keyword") ||
				tok.includes("hljs-literal")
			) {
				insideExcluded = true;
			}
			enrichedHtml += tok;
		} else if (tok.startsWith("</span")) {
			insideExcluded = false;
			enrichedHtml += tok;
		} else {
			if (insideExcluded) {
				enrichedHtml += tok;
			} else {
				let t = tok;
				// 1. Operadores universales
				t = t.replace(
					/(:=|!==|===|!=|==|&amp;&amp;|\|\||-&gt;|=&gt;|&lt;-|\+=|-=|\*=|\/=|%=)/g,
					'<span class="hljs-operator">$1</span>'
				);
				// 2. Llamadas a métodos y funciones: .Method() o function()
				t = t.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="hljs-title">$1</span>');
				// 3. Tipos, structs y clases en PascalCase
				t = t.replace(/(?<![a-zA-Z0-9_])([A-Z][a-zA-Z0-9_]+)\b/g, '<span class="hljs-type">$1</span>');
				enrichedHtml += t;
			}
		}
	}

	const ansiResult = renderHtmlToAnsi(enrichedHtml, pal);
	return ansiResult.split("\n");
}

function patchMarkdownRenderer() {
	const proto = Markdown.prototype as any;
	proto[PATCH_KEY] = true;

	const originalRenderToken = proto._originalRenderToken || proto.renderToken;
	proto._originalRenderToken = originalRenderToken;

	proto.renderToken = function (token: any, width: number, nextTokenType?: string, styleContext?: any) {
		if (token.type !== "code") {
			return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}

		const { lang, displayTitle, icon } = parseHeader(token.lang || "");

		// Filtrar solo si no está en la lista de formatos admitidos
		if (lang && !ALLOWED_LANGUAGES.has(lang)) {
			return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}

		try {
			const boxWidth = Math.max(24, width);
			const { bgAnsi, borderAnsi, tagAnsi, mutedAnsi } = resolveColors();
			const lines: string[] = [];

			// 1. Cabecera simétrica con icono, lenguaje/archivo y minileyenda /cc (╭─ ... ─╮)
			const tagText = displayTitle ? ` ${icon} ${displayTitle} ` : "";
			const tagLen = visibleWidth(tagText);
			const legendText = " /cc ";
			const legendLen = visibleWidth(legendText);

			// Si es diff o patch, no mostramos la minileyenda /cc porque está excluido de copiado
			const isDiff = isDiffBlock(lang);
			const showLegend = !isDiff && boxWidth >= (tagLen + legendLen + 8);
			let topBar = "";

			if (showLegend) {
				const dashes = Math.max(1, boxWidth - 4 - tagLen - legendLen);
				const leftPart = tagText
					? `╭─${RESET_FG}\x1b[1m${tagAnsi}${tagText}${RESET_FG}${borderAnsi}`
					: `╭─`;
				topBar = `${borderAnsi}${leftPart}${"─".repeat(dashes)}${mutedAnsi}${legendText}${RESET_FG}${borderAnsi}─╮${RESET_FG}`;
			} else {
				const dashes = Math.max(0, boxWidth - (tagText ? 3 + tagLen : 2));
				const leftPart = tagText
					? `╭─${RESET_FG}\x1b[1m${tagAnsi}${tagText}${RESET_FG}${borderAnsi}`
					: `╭`;
				topBar = `${borderAnsi}${leftPart}${"─".repeat(dashes)}╮${RESET_FG}`;
			}
			lines.push(`${bgAnsi}${topBar}${RESET_BG}`);

			// 2. Líneas de código con sintaxis resaltada, sangría y soft-wrap (sin barras │ ni truncado con …)
			const rawCode = (token.text || "").replace(/\r\n/g, "\n").replace(/\n$/, "");
			let hlLines: string[] = [];

			if (activeSyntaxMode === "vanilla") {
				if (this.theme && typeof this.theme.highlightCode === "function") {
					hlLines = this.theme.highlightCode(rawCode, lang);
				} else {
					hlLines = rawCode.split("\n");
				}
			} else {
				try {
					hlLines = highlightCodeSmart(rawCode, lang, this.theme || activeUiTheme);
				} catch {
					if (this.theme && typeof this.theme.highlightCode === "function") {
						hlLines = this.theme.highlightCode(rawCode, lang);
					} else {
						hlLines = rawCode.split("\n");
					}
				}
			}

			const leftIndent = "  "; // 2 espacios de sangría para respiro visual
			const indentLen = 2;
			const maxContentWidth = Math.max(10, boxWidth - indentLen);

			for (const rawLine of hlLines) {
				// Soft wrap si la línea excede el ancho disponible: nunca se mutila código con "…"
				const subLines = visibleWidth(rawLine) > maxContentWidth
					? wrapTextWithAnsi(rawLine, maxContentWidth)
					: [rawLine];

				for (const subLine of subLines) {
					const subLen = visibleWidth(subLine);
					// Neutralizar resets completos (\x1b[0m) restaurando inmediatamente el fondo
					const safeLine = subLine.replace(/\x1b\[0m/g, `${RESET_ALL}${bgAnsi}`);
					const pad = " ".repeat(Math.max(0, boxWidth - indentLen - subLen));
					const rowContent = `${leftIndent}${safeLine}${pad}`;
					lines.push(`${bgAnsi}${rowContent}${RESET_BG}`);
				}
			}

			// 3. Borde inferior simétrico redondeado (╰─ ... ─╯)
			const bottomDashes = Math.max(0, boxWidth - 2);
			const bottomBar = `${borderAnsi}╰${"─".repeat(bottomDashes)}╯${RESET_FG}`;
			lines.push(`${bgAnsi}${bottomBar}${RESET_BG}`);

			// 4. Espaciado después del bloque si no sigue un espacio
			if (nextTokenType && nextTokenType !== "space") {
				lines.push("");
			}

			return lines;
		} catch {
			return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}
	};
}

function isDiffBlock(lang: string): boolean {
	const l = (lang || "").trim().toLowerCase();
	return l === "diff" || l === "patch";
}

async function copySingleBlock(block: { lang: string; title: string; code: string }, index: number, total: number, ctx: any) {
	try {
		await copyToClipboard(block.code);
		if (ctx.hasUI) {
			const lineCount = block.code.split("\n").length;
			const label = block.title || block.lang || "código";
			ctx.ui.notify(`Copiado al portapapeles [${index + 1}/${total}]: ${label} (${lineCount} líneas)`, "info");
		}
	} catch (err: any) {
		if (ctx.hasUI) {
			ctx.ui.notify(`Error al copiar al portapapeles: ${err?.message || String(err)}`, "error");
		}
	}
}

async function copyAllBlocks(blocks: Array<{ lang: string; title: string; code: string }>, ctx: any) {
	try {
		const combined = blocks.map((b) => b.code).join("\n\n");
		await copyToClipboard(combined);
		if (ctx.hasUI) {
			const totalLines = combined.split("\n").length;
			ctx.ui.notify(`Copiados todos los bloques de código (${blocks.length} snippets, ${totalLines} líneas combinadas)`, "info");
		}
	} catch (err: any) {
		if (ctx.hasUI) {
			ctx.ui.notify(`Error al copiar todos los bloques: ${err?.message || String(err)}`, "error");
		}
	}
}

function getLastAssistantCodeBlocks(ctx: any): { blocks: Array<{ lang: string; title: string; code: string }>; rawCount: number } {
	const entries = ctx.sessionManager?.getEntries?.() || [];
	let lastAssistantText = "";

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "assistant") {
			const content = entry.message.content;
			if (Array.isArray(content)) {
				lastAssistantText = content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
			} else if (typeof content === "string") {
				lastAssistantText = content;
			}
			if (lastAssistantText.trim()) break;
		}
	}

	const rawBlocks = extractCodeBlocks(lastAssistantText);
	const blocks = rawBlocks.filter((b) => !isDiffBlock(b.lang));
	return { blocks, rawCount: rawBlocks.length };
}

function formatForEditor(block: { lang: string; title: string; code: string }): string {
	// Si es bash/sh o shell, lo insertamos plano para poder ejecutarlo o editarlo directo
	if (block.lang === "bash" || block.lang === "sh" || block.lang === "zsh" || block.lang === "fish") {
		return block.code;
	}
	// Para lenguajes de programación, lo formateamos en bloque markdown
	const tag = block.lang || "";
	return `\`\`\`${tag}\n${block.code}\n\`\`\``;
}

function insertIntoEditor(textToInsert: string, label: string, ctx: any) {
	if (!ctx.hasUI) return;

	if (typeof ctx.ui?.pasteToEditor === "function") {
		// pasteToEditor activa el comportamiento nativo del editor de Pi:
		// cuando el texto es largo (>10 líneas o >1000 chars), se colapsa automáticamente
		// en el marcador [paste #N +X lines], evitando inundar el editor de texto
		const current = (typeof ctx.ui?.getEditorText === "function" ? ctx.ui.getEditorText() : "") || "";
		if (current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n")) {
			ctx.ui.pasteToEditor(" ");
		}
		ctx.ui.pasteToEditor(textToInsert);
		ctx.ui.notify(`Insertado en el prompt: ${label}`, "info");
	} else if (typeof ctx.ui?.setEditorText === "function") {
		const current = (typeof ctx.ui?.getEditorText === "function" ? ctx.ui.getEditorText() : "") || "";
		let finalPrompt = "";
		if (current.trim()) {
			finalPrompt = `${current.trim()}\n\n${textToInsert}`;
		} else {
			finalPrompt = textToInsert;
		}
		ctx.ui.setEditorText(finalPrompt);
		ctx.ui.notify(`Insertado en el prompt: ${label}`, "info");
	}
}

async function handleInsertCode(args: string, ctx: any) {
	const { blocks, rawCount } = getLastAssistantCodeBlocks(ctx);
	if (blocks.length === 0) {
		if (ctx.hasUI) {
			if (rawCount > 0) {
				ctx.ui.notify("Solo se encontraron bloques de diff (excluidos)", "info");
			} else {
				ctx.ui.notify("No se encontró ningún bloque de código en el último mensaje", "warning");
			}
		}
		return;
	}

	const trimmedArg = args.trim().toLowerCase();

	// 1. /ci all
	if (trimmedArg === "all" || trimmedArg === "todos") {
		const combined = blocks.map(formatForEditor).join("\n\n");
		insertIntoEditor(combined, `Todos los bloques (${blocks.length} snippets)`, ctx);
		return;
	}

	// 2. /ci <n>
	const argNum = parseInt(trimmedArg, 10);
	if (!isNaN(argNum) && argNum >= 1 && argNum <= blocks.length) {
		const target = blocks[argNum - 1];
		insertIntoEditor(formatForEditor(target), target.title || target.lang || "código", ctx);
		return;
	}

	// 3. Selector interactivo (siempre visible con UI, exactamente igual que Alt+C)
	if (ctx.hasUI && typeof ctx.ui?.select === "function") {
		const blockOptions = blocks.map((b, idx) => {
			const lines = b.code.split("\n").length;
			const icon = LANG_ICONS[b.lang] || "󰅪";
			const title = b.title || b.lang || "código";
			return `[${idx + 1}] ${icon} ${title} (${lines} líneas)`;
		});

		let options: string[] = [];
		let allOption = "";
		if (blocks.length > 1) {
			allOption = `[★] 󰉉 Insertar todos los bloques (${blocks.length} snippets combinados)`;
			options = [allOption, ...blockOptions];
		} else {
			options = blockOptions;
		}

		const choice = await ctx.ui.select("Selecciona qué bloque insertar en el prompt:", options);
		if (!choice) return;

		if (allOption && choice === allOption) {
			const combined = blocks.map(formatForEditor).join("\n\n");
			insertIntoEditor(combined, `Todos los bloques (${blocks.length} snippets)`, ctx);
			return;
		}

		const selectedIndex = blockOptions.indexOf(choice);
		if (selectedIndex !== -1) {
			const target = blocks[selectedIndex];
			insertIntoEditor(formatForEditor(target), target.title || target.lang || "código", ctx);
			return;
		}
	}

	// 4. Fallback sin UI: insertar el último
	const last = blocks[blocks.length - 1];
	insertIntoEditor(formatForEditor(last), last.title || last.lang || "código", ctx);
}

async function handleCopyCode(args: string, ctx: any) {
	const { blocks, rawCount } = getLastAssistantCodeBlocks(ctx);
	if (blocks.length === 0) {
		if (ctx.hasUI) {
			if (rawCount > 0) {
				ctx.ui.notify("Solo se encontraron bloques de diff (excluidos de copiado)", "info");
			} else {
				ctx.ui.notify("No se encontró ningún bloque de código en el último mensaje", "warning");
			}
		}
		return;
	}

	const trimmedArg = args.trim().toLowerCase();

	// 1. /cc all o /cc todos
	if (trimmedArg === "all" || trimmedArg === "todos") {
		await copyAllBlocks(blocks, ctx);
		return;
	}

	// 2. /cc <n> índice explícito (1-based)
	const argNum = parseInt(trimmedArg, 10);
	if (!isNaN(argNum) && argNum >= 1 && argNum <= blocks.length) {
		await copySingleBlock(blocks[argNum - 1], argNum - 1, blocks.length, ctx);
		return;
	}

	// 3. Si solo hay 1 bloque: copiar directamente sin diálogo
	if (blocks.length === 1) {
		await copySingleBlock(blocks[0], 0, 1, ctx);
		return;
	}

	// 4. Múltiples bloques con selector interactivo disponible
	if (ctx.hasUI && typeof ctx.ui?.select === "function") {
		const allOption = `[★] 󰉉 Copiar todos los bloques (${blocks.length} snippets combinados)`;
		const blockOptions = blocks.map((b, idx) => {
			const lines = b.code.split("\n").length;
			const icon = LANG_ICONS[b.lang] || "󰅪";
			const title = b.title || b.lang || "código";
			return `[${idx + 1}] ${icon} ${title} (${lines} líneas)`;
		});

		const options = [allOption, ...blockOptions];
		const choice = await ctx.ui.select("Selecciona qué bloque de código copiar:", options);
		if (!choice) {
			return; // Usuario canceló con Esc / Ctrl+C
		}

		if (choice === allOption) {
			await copyAllBlocks(blocks, ctx);
			return;
		}

		const selectedIndex = blockOptions.indexOf(choice);
		if (selectedIndex !== -1) {
			await copySingleBlock(blocks[selectedIndex], selectedIndex, blocks.length, ctx);
			return;
		}
	}

	// 5. Fallback sin UI interactiva: copiar el último
	await copySingleBlock(blocks[blocks.length - 1], blocks.length - 1, blocks.length, ctx);
}

export default function piMessagesExtension(pi: ExtensionAPI) {
	patchMarkdownRenderer();

	// Registrar comandos /cc y /copy-code (copiar al portapapeles)
	pi.registerCommand("cc", {
		description: "Copia código al portapapeles (/cc, /cc all, o /cc <n>)",
		handler: async (args, ctx) => {
			await handleCopyCode(args, ctx);
		},
	});

	pi.registerCommand("copy-code", {
		description: "Copia código al portapapeles (/copy-code, /copy-code all, o /copy-code <n>)",
		handler: async (args, ctx) => {
			await handleCopyCode(args, ctx);
		},
	});

	// Registrar comandos /ci y /insert-code (insertar directo en el editor de Pi)
	pi.registerCommand("ci", {
		description: "Inserta código en el editor del prompt (/ci, /ci all, o /ci <n>)",
		handler: async (args, ctx) => {
			await handleInsertCode(args, ctx);
		},
	});

	pi.registerCommand("insert-code", {
		description: "Inserta código en el editor del prompt (/insert-code, /insert-code all, o /insert-code <n>)",
		handler: async (args, ctx) => {
			await handleInsertCode(args, ctx);
		},
	});

	// Registrar atajo de teclado global Alt+C (Copiar)
	pi.registerShortcut("alt+c", {
		description: "Copia código al portapapeles (interactivo si hay múltiples)",
		handler: async (ctx) => {
			await handleCopyCode("", ctx);
		},
	});

	// Registrar atajo de teclado global Alt+I (Insertar en prompt)
	pi.registerShortcut("alt+i", {
		description: "Inserta código en el editor del prompt (interactivo si hay múltiples)",
		handler: async (ctx) => {
			await handleInsertCode("", ctx);
		},
	});

	// Registrar comandos para configurar el motor de color (/pi-color, /picolor, /pimessages:color)
	const colorCommandHandler = async (_args: string, ctx: any) => {
		if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
			return;
		}

		const optPiColor = `[★] 󰏘 PiColor (Motor semántico universal enriquecido: métodos, structs, tipos y operadores)`;
		const optVanilla = `[○] 󰆍 Vanilla (Motor clásico por defecto de Pi: solo palabras reservadas y strings)`;

		const options = [optPiColor, optVanilla];
		const currentDesc = activeSyntaxMode === "picolor" ? "PiColor (Enriquecido)" : "Vanilla (Defecto Pi)";

		const choice = await ctx.ui.select(
			`Selecciona el motor de resaltado de código (Actual: ${currentDesc}):`,
			options
		);

		if (!choice) return;

		let newMode: SyntaxEngineMode = "picolor";
		if (choice === optVanilla) {
			newMode = "vanilla";
		}

		if (newMode !== activeSyntaxMode) {
			activeSyntaxMode = newMode;
			saveSyntaxMode(newMode);

			if (ctx.hasUI) {
				const modeLabel = newMode === "picolor" ? "PiColor (Enriquecido)" : "Vanilla (Defecto Pi)";
				ctx.ui.notify(`Motor de sintaxis cambiado a: ${modeLabel}`, "info");
			}

			// Disparar recarga automática de la sesión de Pi
			try {
				if (typeof ctx.reload === "function") {
					await ctx.reload();
				} else if (typeof (ctx as any).session?.reload === "function") {
					await (ctx as any).session.reload();
				}
			} catch {}
		} else {
			if (ctx.hasUI) {
				ctx.ui.notify(`Ya estás usando el modo ${activeSyntaxMode === "picolor" ? "PiColor" : "Vanilla"}`, "info");
			}
		}
	};

	pi.registerCommand("picolor", {
		description: "Configura el motor de color para bloques de código (PiColor vs Vanilla)",
		handler: colorCommandHandler,
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.ui && ctx.ui.theme) {
			activeUiTheme = ctx.ui.theme;
		}
	});

	pi.on("turn_start", (_event, ctx) => {
		if (ctx.ui && ctx.ui.theme) {
			activeUiTheme = ctx.ui.theme;
		}
	});
}
