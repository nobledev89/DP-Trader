const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export function hasLlmCredentials(config) {
  return Boolean(config?.anthropic?.key || config?.openai?.key);
}

export function llmProvider(config) {
  if (config?.anthropic?.key) return "anthropic";
  if (config?.openai?.key) return "openai";
  return null;
}

export async function callTradingDecision(config, payload) {
  const provider = llmProvider(config);
  if (!provider) return null;
  const system = buildSystemPrompt();
  const user = JSON.stringify(payload);
  if (provider === "anthropic") {
    return callAnthropic(config.anthropic, system, user);
  }
  return callOpenAi(config.openai, system, user);
}

async function callAnthropic(anthropic, system, user) {
  const model = anthropic.model || "claude-sonnet-4-6";
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": anthropic.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic call failed: ${response.status} ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  const text = (data.content || []).map((block) => block.text || "").join("");
  return {
    provider: "anthropic",
    model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    raw: text,
    decision: parseDecision(text)
  };
}

async function callOpenAi(openai, system, user) {
  const model = openai.model || "gpt-4o-mini";
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openai.key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI call failed: ${response.status} ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return {
    provider: "openai",
    model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    raw: text,
    decision: parseDecision(text)
  };
}

function buildSystemPrompt() {
  return [
    "You are a disciplined intraday equity trading assistant operating on US paper trading.",
    "Decide whether to enter a single bracket trade based on the live data passed in.",
    "Be skeptical: only approve trades with a clear edge (trend, momentum, or mean-reversion setup) and acceptable reward/risk.",
    "Reject trades when the spread is wide relative to ATR, when reward/risk is below 1.5, or when signals conflict.",
    "Respond ONLY with compact JSON of the form:",
    '{"approve":boolean,"confidence":number(0-1),"rationale":string,"reasonCodes":string[]}',
    "Do not include any prose outside the JSON object."
  ].join("\n");
}

function parseDecision(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence)));
    return {
      approve: Boolean(parsed.approve),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      rationale: String(parsed.rationale || "").slice(0, 600),
      reasonCodes: Array.isArray(parsed.reasonCodes) ? parsed.reasonCodes.map(String).slice(0, 8) : []
    };
  } catch {
    return null;
  }
}
