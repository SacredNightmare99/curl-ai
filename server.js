import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";
import { OpenRouter } from "@openrouter/sdk";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openRouter = new OpenRouter({
  apiKey: process.env.API_KEY,
});

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

const MODELS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "google/gemma-3-27b-it:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "liquid/lfm-2.5-1.2b-thinking:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
  "arcee-ai/trinity-mini:free",
  "openai/gpt-oss-20b:free",
  "minimax/minimax-m2.5:free",
  "z-ai/glm-4.5-air:free",
  "openrouter/free"
];

// -------- PDF TEXT EXTRACTION --------
async function extractPdfText(buffer) {
  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str);
    text += strings.join(" ") + "\n";
  }

  return text;
}

// -------- INFO --------
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain");

  const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:7000";

  const PROXY_HOST = process.env.PROXY_HOST;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USER = process.env.PROXY_USER;
  const PROXY_PASS = process.env.PROXY_PASS;

  const hasProxy =
    PROXY_HOST && PROXY_PORT && PROXY_USER && PROXY_PASS;

  const proxyLinux = hasProxy
    ? `-x http://${PROXY_HOST}:${PROXY_PORT} --proxy-user ${PROXY_USER}:${PROXY_PASS}`
    : "";

  const proxyWin = hasProxy
    ? `-x http://${PROXY_HOST}:${PROXY_PORT} --proxy-user ${PROXY_USER}:${PROXY_PASS}`
    : "";

  res.send(`
OpenRouter Proxy (Plain Text)

======================
Linux / macOS
======================

1) Prompt only
--------------------------------
curl ${proxyLinux} -X POST ${PUBLIC_URL}/chat \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Explain recursion"}'

2) File only
--------------------------------
curl ${proxyLinux} -X POST ${PUBLIC_URL}/chat \\
  -F "file=@notes.txt"

3) File + instruction
--------------------------------
curl ${proxyLinux} -X POST ${PUBLIC_URL}/chat \\
  -F "file=@notes.pdf" \\
  -F "prompt=Summarize this in bullet points"


======================
Windows (curl.exe - PowerShell / cmd)
======================

1) Prompt only
--------------------------------
curl.exe ${proxyWin} -X POST ${PUBLIC_URL}/chat ^
  -H "Content-Type: application/json" ^
  -d "{\\"prompt\\":\\"Explain recursion\\"}"

2) File only
--------------------------------
curl.exe ${proxyWin} -X POST ${PUBLIC_URL}/chat ^
  -F "file=@notes.txt"

3) File + instruction
--------------------------------
curl.exe ${proxyWin} -X POST ${PUBLIC_URL}/chat ^
  -F "file=@notes.pdf" ^
  -F "prompt=Summarize this in bullet points"


Notes:
- Supports: .txt, .md, .json, .pdf, .docx
- Response is plain text (no JSON)
- Free models may rate-limit, retry if needed
`.trim());
});

// -------- MAIN ROUTE --------
app.post("/chat", upload.single("file"), async (req, res) => {
  try {
    let userPrompt = req.body.prompt || "";
    let fileContent = "";

    if (req.file) {
      const buffer = fs.readFileSync(req.file.path);

      if (req.file.mimetype === "application/pdf") {
        fileContent = await extractPdfText(buffer);
      } else if (
        req.file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const result = await mammoth.extractRawText({ buffer });
        fileContent = result.value;
      } else {
        fileContent = buffer.toString("utf-8");
      }

      fs.unlinkSync(req.file.path);
    }

    let prompt = "";

    if (fileContent && userPrompt) {
      prompt = `INSTRUCTION:\n${userPrompt}\n\nCONTENT:\n${fileContent}`;
    } else if (fileContent) {
      prompt = fileContent;
    } else {
      prompt = userPrompt;
    }

    if (!prompt) {
      return res.status(400).send("Missing prompt or file");
    }

    prompt = prompt.slice(0, 20000);

    const messages = [{ role: "user", content: prompt }];

    let lastError = null;

    // ---- OPENROUTER ----
    if (process.env.API_KEY) {
      for (const model of MODELS) {
        try {
          const completion = await openRouter.chat.send({
            chatGenerationParams: { model, messages },
          });

          const content =
            completion.choices?.[0]?.message?.content ?? "";

          if (content) {
            res.setHeader("Content-Type", "text/plain");
            return res.send(content);
          }

        } catch (err) {
          console.error("OpenRouter error:", err);
          lastError = err;

          const status = err.statusCode || err.status;
          if (status === 404) continue;
          if (status !== 429) break;

          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    // ---- GEMINI ----
    if (gemini) {
      try {
        const model = gemini.getGenerativeModel({
          model: "gemini-3-flash-preview",
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        if (text) {
          res.setHeader("Content-Type", "text/plain");
          return res.send(text);
        }

      } catch (err) {
        console.error("Gemini error:", err);
        lastError = err;
      }
    }

    return res.status(500).send("All providers failed. Try again.");

  } catch (err) {
    console.error("Internal error:", err);
    res.status(500).send("Internal server error");
  }
});

// -------- START SERVER --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Running on http://localhost:${PORT}`);
});
