import express from "express";
import cors from "cors";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const BACKEND_LOGS = [];

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function normalizeJiraBaseUrl(rawUrl = "") {
  const input = String(rawUrl || "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input.startsWith("http") ? input : `https://${input}`);
    return parsed.origin;
  } catch {
    return input.replace(/\/+$/, "");
  }
}

async function parseResponse(res) {
  const text = await res.text();
  try {
    return { data: JSON.parse(text), raw: text };
  } catch {
    return { data: null, raw: text };
  }
}

function pushLog(entry) {
  const row = {
    ts: new Date().toISOString(),
    ...entry,
  };
  BACKEND_LOGS.push(row);
  if (BACKEND_LOGS.length > 400) BACKEND_LOGS.shift();
}

app.get("/api/health", (_req, res) => {
  pushLog({ source: "BE", method: "GET", path: "/api/health", status: 200 });
  res.json({ ok: true, service: "backend", port: PORT });
});

app.get("/api/logs", (_req, res) => {
  res.json({ logs: BACKEND_LOGS.slice(-200).reverse() });
});

app.post("/api/jira/request", async (req, res) => {
  const started = Date.now();
  try {
    const { baseUrl, email, token, method = "GET", path = "", body, api = "core" } = req.body || {};
    const jiraBaseUrl = normalizeJiraBaseUrl(baseUrl);
    const cleanEmail = String(email || "").trim();
    const cleanToken = String(token || "").replace(/\s+/g, "");

    if (!jiraBaseUrl || !cleanEmail || !cleanToken || !path) {
      pushLog({ source: "BE", service: "jira", method, path, status: 400, ms: Date.now() - started, message: "Missing required Jira request fields." });
      return res.status(400).json({ message: "Missing required Jira request fields." });
    }

    const apiRoot = api === "agile" ? "/rest/agile/1.0" : "/rest/api/3";
    const target = `${jiraBaseUrl}${apiRoot}${path}`;
    const headers = {
      Authorization: `Basic ${Buffer.from(`${cleanEmail}:${cleanToken}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const upstream = await fetch(target, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const parsed = await parseResponse(upstream);
    if (!upstream.ok) {
      const detail =
        parsed.data?.errorMessages?.[0] ||
        parsed.data?.message ||
        parsed.raw ||
        `HTTP ${upstream.status}`;
      pushLog({ source: "BE", service: "jira", method, path, status: upstream.status, ms: Date.now() - started, message: detail });
      return res.status(upstream.status).json({
        message: detail,
        status: upstream.status,
        method,
        path,
        api,
      });
    }

    pushLog({ source: "BE", service: "jira", method, path, status: upstream.status, ms: Date.now() - started });
    return res.status(upstream.status).json(parsed.data ?? {});
  } catch (err) {
    pushLog({ source: "BE", service: "jira", method: req.body?.method || "POST", path: req.body?.path || "/unknown", status: 500, ms: Date.now() - started, message: err.message || "Internal server error" });
    return res.status(500).json({ message: err.message || "Internal server error" });
  }
});

app.post("/api/github/request", async (req, res) => {
  const started = Date.now();
  try {
    const { token, method = "GET", path = "", body } = req.body || {};
    const cleanToken = String(token || "").replace(/\s+/g, "");
    if (!cleanToken || !path) {
      pushLog({ source: "BE", service: "github", method, path, status: 400, ms: Date.now() - started, message: "Missing required GitHub request fields." });
      return res.status(400).json({ message: "Missing required GitHub request fields." });
    }

    const target = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const upstream = await fetch(target, {
      method,
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const parsed = await parseResponse(upstream);
    if (!upstream.ok) {
      const detail = parsed.data?.message || parsed.raw || `HTTP ${upstream.status}`;
      const githubMeta = {
        requestId: upstream.headers.get("x-github-request-id") || "",
        oauthScopes: upstream.headers.get("x-oauth-scopes") || "",
        acceptedOauthScopes: upstream.headers.get("x-accepted-oauth-scopes") || "",
        acceptedPermissions: upstream.headers.get("x-accepted-github-permissions") || "",
        documentationUrl: parsed.data?.documentation_url || "",
      };
      pushLog({ source: "BE", service: "github", method, path, status: upstream.status, ms: Date.now() - started, message: detail });
      return res.status(upstream.status).json({
        message: detail,
        status: upstream.status,
        method,
        path,
        github: githubMeta,
      });
    }

    pushLog({ source: "BE", service: "github", method, path, status: upstream.status, ms: Date.now() - started });
    return res.status(upstream.status).json(parsed.data ?? {});
  } catch (err) {
    pushLog({ source: "BE", service: "github", method: req.body?.method || "POST", path: req.body?.path || "/unknown", status: 500, ms: Date.now() - started, message: err.message || "Internal server error" });
    return res.status(500).json({ message: err.message || "Internal server error" });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  const started = Date.now();
  console.log("[Groq] Received chat request");
  try {
    const { apiKey, system, messages, model, maxTokens = 1000 } = req.body || {};
    
    if (!apiKey) {
      console.log("[Groq] Missing API key");
      pushLog({ source: "BE", service: "groq", method: "POST", path: "/api/ai/chat", status: 400, ms: Date.now() - started, message: "Missing API key." });
      return res.status(400).json({ message: "Missing API key." });
    }

    console.log("[Groq] Calling Groq API...");
    const target = "https://api.groq.com/openai/v1/chat/completions";
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      model: model || "llama-3.3-70b-versatile",
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        ...messages,
      ],
      max_tokens: maxTokens,
    });

    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body,
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      console.log("[Groq] API error:", upstream.status, errorText);
      pushLog({ source: "BE", service: "groq", method: "POST", path: "/api/ai/chat", status: upstream.status, ms: Date.now() - started, message: errorText });
      return res.status(upstream.status).json({ message: errorText });
    }

    const data = await upstream.json();
    console.log("[Groq] Success");
    
    // Extract text from Groq/OpenAI response
    let normalizedText = "";
    if (data.choices && data.choices[0]?.message?.content) {
      normalizedText = data.choices[0].message.content;
    }
    
    pushLog({ source: "BE", service: "groq", method: "POST", path: "/api/ai/chat", status: upstream.status, ms: Date.now() - started });
    return res.status(200).json({ content: [{ text: normalizedText }] });
  } catch (err) {
    console.log("[Groq] Error:", err.message);
    pushLog({ source: "BE", service: "groq", method: "POST", path: "/api/ai/chat", status: 500, ms: Date.now() - started, message: err.message || "Internal server error" });
    return res.status(500).json({ message: err.message || "Internal server error" });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend API running at http://localhost:${PORT}`);
});
