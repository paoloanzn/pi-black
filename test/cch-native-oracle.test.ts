import { describe, expect, test } from "vitest";
import { patchClaudeCodeCch } from "../src/claude-code-protocol.js";

// cch values produced by the REAL claude-code 2.1.295 native engine (bun fork),
// captured 2026-10-09 through the claude-harness / mitm hermetic chain.
// Spec (reverse engineered): xxHash64 over JSON.stringify(body with model -> "" when
// present, max_tokens removed when present, every tools[i].model -> "" when present),
// seed 0x4d659218e32a3268, masked with 0xfffff, lowercased 5 hex chars.
const BILLING_SDK = "x-anthropic-billing-header: cc_version=2.1.258.01c; cc_entrypoint=sdk-cli; cch=00000;";
const BILLING_CLI = "x-anthropic-billing-header: cc_version=2.1.295.8a8; cc_entrypoint=cli; cch=00000;";
const AGENT_SDK_SYSTEM_PROMPT = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

const ORACLES: Array<{ name: string; body: string; cch: string }> = [
  {
    name: "tools with advisor model + stream + metadata",
    cch: "98a40",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system: [
        { type: "text", text: BILLING_SDK },
        { type: "text", text: AGENT_SDK_SYSTEM_PROMPT },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "oracle b1" }] }],
      tools: [
        {
          name: "Bash",
          description: "run commands",
          input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
          eager_input_streaming: true,
        },
        { type: "advisor_20260301", name: "advisor", model: "claude-opus-5-5", defer_loading: true },
      ],
      stream: true,
      metadata: { user_id: '{"device_id":"a","account_uuid":"b","session_id":"c"}' },
    }),
  },
  {
    name: "no model key + tools with model",
    cch: "76292",
    body: JSON.stringify({
      max_tokens: 64,
      system: [
        { type: "text", text: BILLING_SDK },
        { type: "text", text: AGENT_SDK_SYSTEM_PROMPT },
      ],
      messages: [{ role: "user", content: "oracle b2" }],
      tools: [{ model: "claude-opus-5-5", type: "advisor_20260301", name: "advisor" }],
    }),
  },
  {
    name: "no max_tokens + multiple tool models",
    cch: "8987c",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [
        { role: "user", content: "oracle b3" },
        { role: "assistant", content: "ok" },
      ],
      tools: [
        { name: "a", model: "zz" },
        { name: "b", model: "yy" },
        { name: "c", description: "d" },
      ],
    }),
  },
  {
    name: "nested model key inside message block (emptied at any depth)",
    cch: "6c48a",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 32,
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [
        { role: "user", content: [{ type: "text", text: "nested", model: "NESTEDSECRET" }] },
      ],
    }),
  },
  {
    name: "fallbacks + fallback_credit_token dropped, max_tokens last",
    cch: "cafd5",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "b" }],
      fallbacks: [{ model: "a" }],
      fallback_credit_token: "tok",
      system: [{ type: "text", text: BILLING_CLI }],
      tools: [{ name: "t", model: "m" }],
      max_tokens: 64,
    }),
  },
  {
    name: "numeric model value left untouched",
    cch: "7b3b5",
    body: JSON.stringify({
      model: 123,
      max_tokens: 32,
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [{ role: "user", content: "c" }],
    }),
  },
  {
    name: "single trailing max_tokens removed cleanly (no dangling comma)",
    cch: "e36e6",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [{ role: "user", content: "d" }],
      max_tokens: 64,
    }),
  },
  {
    name: "fallbacks alone in the middle",
    cch: "49455",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "e" }],
      fallbacks: [{ model: "fb" }],
      system: [{ type: "text", text: BILLING_CLI }],
      max_tokens: 48,
    }),
  },
  {
    name: "two trailing excluded members keep the preceding comma",
    cch: "f780f",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [{ role: "user", content: "f" }],
      fallbacks: [],
      max_tokens: 64,
    }),
  },
  {
    name: "three trailing excluded members keep the preceding comma",
    cch: "2c970",
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: BILLING_CLI }],
      messages: [{ role: "user", content: "g" }],
      fallbacks: [{ model: "x" }],
      fallback_credit_token: "t",
      max_tokens: 64,
    }),
  },
];

describe("patchClaudeCodeCch against native oracle values", () => {
  for (const oracle of ORACLES) {
    test(oracle.name, () => {
      const patched = patchClaudeCodeCch(oracle.body);
      const system = JSON.parse(patched).system as Array<{ type: string; text: string }>;
      expect(system[0].text).toContain(`cch=${oracle.cch};`);
    });
  }
});