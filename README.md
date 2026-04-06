# curl-ai

A simple Express server that lets you call free OpenRouter chat models using `curl`.

It supports:
- Prompt-only requests
- File-only requests
- File + instruction requests
- Automatic fallback across multiple free models when rate-limited

Responses are returned as plain text for shell-friendly usage.

## Features

- `POST /chat` endpoint for text generation
- Accepts JSON (`application/json`) and multipart form uploads
- File support: `.txt`, `.md`, `.json`, `.pdf`, `.docx`
- Extracts text from PDF and DOCX before sending to the model
- Truncates combined prompt content to 12,000 characters
- Plain-text output (not JSON)

## Requirements

- Node.js 18+
- An OpenRouter API key

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```env
API_KEY=your_openrouter_api_key
PORT=3000
PUBLIC_URL=http://localhost:3000
```

Notes:
- `API_KEY` is required.
- `PORT` is optional (defaults to `3000`).
- `PUBLIC_URL` is optional and only used to render example curl commands in `GET /`.

3. Start the server:

```bash
npm start
```

For development (auto-restart):

```bash
npm run dev
```

## Quick Test

Check server help text:

```bash
curl http://localhost:3000/
```

## API

### `POST /chat`

Send either:
- JSON with `prompt`
- Multipart with `file`
- Multipart with both `file` and `prompt`

Returns plain text.

#### Prompt only (Linux/macOS)

```bash
curl -X POST http://localhost:3000/chat \
	-H "Content-Type: application/json" \
	-d '{"prompt":"Explain recursion"}'
```

#### Prompt only (Windows PowerShell/cmd)

```powershell
curl.exe -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"prompt\":\"Explain recursion\"}"
```

#### File only

```bash
curl -X POST http://localhost:3000/chat \
	-F "file=@notes.txt"
```

#### File + instruction

```bash
curl -X POST http://localhost:3000/chat \
	-F "file=@notes.pdf" \
	-F "prompt=Summarize this in bullet points"
```

## How It Works

1. If a file is provided, text is extracted:
- PDF via `pdfjs-dist`
- DOCX via `mammoth`
- Other types via UTF-8 read
2. If both file text and prompt are provided, they are combined into:
	 - `INSTRUCTION:` prompt text
	 - `CONTENT:` extracted file text
3. The final prompt is trimmed to 12,000 characters.
4. The server tries a list of free models and falls back on `429` rate-limit errors.
5. First successful model response is returned as plain text.

## Error Responses

- `400 Missing prompt or file` if both are empty
- `500 All free models failed. Try again.` if all model attempts fail
- `500 Internal server error` for unexpected server errors

## Project Structure

```text
.
├── server.js
├── package.json
├── README.md
└── uploads/
```

`uploads/` is used for temporary files during request handling.

## Scripts

- `npm start` - start server
- `npm run dev` - run with Node watch mode

## Notes

- Free model availability and rate limits can vary.
- If you get frequent failures, retry the request.
