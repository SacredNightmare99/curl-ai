import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";
import { OpenRouter } from "@openrouter/sdk";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const openRouter = new OpenRouter({
  apiKey: process.env.API_KEY,
});

const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:3000";

const MODELS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "stepfun/step-3.5-flash:free",
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

// -------- PDF TEXT EXTRACTION (ESM-safe) --------
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

  res.send(`
OpenRouter Proxy (Plain Text)

======================
Linux / macOS
======================

1) Prompt only
--------------------------------
curl -X POST ${PUBLIC_URL}/chat -H "Content-Type: application/json" -d '{"prompt":"Explain recursion"}'

2) File only
--------------------------------
curl -X POST ${PUBLIC_URL}/chat -F "file=@notes.txt"

3) File + instruction
--------------------------------
curl -X POST ${PUBLIC_URL}/chat -F "file=@notes.pdf" -F "prompt=Summarize this in bullet points"


======================
Windows (curl.exe - PowerShell / cmd)
======================

1) Prompt only
--------------------------------
curl.exe -X POST ${PUBLIC_URL}/chat -H "Content-Type: application/json" -d "{\"prompt\":\"Explain recursion\"}"

2) File only
--------------------------------
curl.exe -X POST ${PUBLIC_URL}/chat -F "file=@notes.txt"

3) File + instruction
--------------------------------
curl.exe -X POST ${PUBLIC_URL}/chat -F "file=@notes.pdf" -F "prompt=Summarize this in bullet points"


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

    // ---- FILE HANDLING ----
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

    // ---- COMBINE PROMPT ----
    let prompt = "";

    if (fileContent && userPrompt) {
      prompt = `
INSTRUCTION:
${userPrompt}

CONTENT:
${fileContent}
`.trim();

    } else if (fileContent) {
      prompt = fileContent;

    } else {
      prompt = userPrompt;
    }

    if (!prompt) {
      return res.status(400).send("Missing prompt or file");
    }

    // ---- LIMIT SIZE (important for free models) ----
    prompt = prompt.slice(0, 12000);

    const messages = [{ role: "user", content: prompt }];

    let lastError = null;

    // ---- MODEL FALLBACK LOOP ----
    for (const model of MODELS) {
      try {
        const completion = await openRouter.chat.send({
          chatGenerationParams: {
            model,
            messages,
          },
        });

        const content =
          completion.choices?.[0]?.message?.content ?? "";

        res.setHeader("Content-Type", "text/plain");
        return res.send(content);

      } catch (err) {
        lastError = err;

        if (err.statusCode !== 429) break;

        await new Promise((r) => setTimeout(r, 800));
      }
    }

    return res
      .status(500)
      .send("All free models failed. Try again.");

  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

// -------- START SERVER --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Running on http://localhost:${PORT}`);
});
