# QA — AI Studio chat, AI component ranking, Voice CAD

- **Chat with the local model** (`ui/src/ai/chat.ts`): every message is routed by a one-word grammar-constrained
  call (`edit` / `answer`, few-shot examples, EN + VI). Edits of the open drawing go to the existing CAD pipeline
  (validated proposal → approve → undo). Questions get a free-text answer grounded in short project facts (open
  drawing, BIM model) with the last turns as context; Vietnamese questions get an explicit reply-language line.
  **Calculations are never done by the model**: it writes `[[expression]]`, the app evaluates it with a safe parser
  (`calc`, unit-tested: `tools/unit/chat.test.ts`).
  Desktop `e2e_aichat.js` 3/3 with Qwen2.5-7B: "24 walls and 4 levels" (1.4 s); "Draw a line from 0,0 to 5000,0"
  → pending proposal +1; "Tường dày 200 mm … 4 m cao 3 m" → "Thể tích của bức tường là 2.4 m³" (the first try
  without the calculator answered 240 m³ — the reason for the bracket rule).
- **AI Recommended components** (`ui/src/library/recommend.ts`): rule-based relevance from what the project holds
  (layers, door / window families, wall types, interior items, MEP equipment and fixtures, structure), recent use
  and favourites — labelled as rule-based; "Rank with the local AI" lets the model order the top 16 under a GBNF
  id list (labelled with model and time). Desktop `e2e_comprank.js` PASS (3.3 s).
- **Voice CAD** (`native/app/src/speech_input_*.{mm,cpp}`): on-device only — macOS Speech framework with
  `requiresOnDeviceRecognition` (+ microphone / speech usage strings in Info.plist), Windows SAPI 5 dictation;
  the transcript fills the chat box for the user to check and send (speech never edits by itself). On this Mac:
  en-US on-device available, vi-VN not (reported honestly; the app then listens in English and says so).
  Not tested end-to-end here: the first use asks for microphone and speech-recognition permission, which only the
  user can grant.
