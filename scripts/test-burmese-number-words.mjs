import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadCommonJsModule(path, requireModule = () => ({})) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const sandbox = {
    exports: {},
    require: requireModule
  };
  vm.runInNewContext(compiled, sandbox, { filename: path });
  return sandbox.exports;
}

const numberWords = loadCommonJsModule("../src/lib/burmese-number-words.ts");
const normalizer = loadCommonJsModule("../src/lib/burmese-normalizer.ts", (moduleName) => {
  if (moduleName === "./burmese-number-words") return numberWords;
  return {};
});

const { expandBurmeseNumberTokens, spelloutBurmeseNumberToken } = numberWords;
const { applyBurmeseLexiconEntries, normalizeBurmeseScript } = normalizer;

const spelloutCases = [
  ["\u1041\u1049\u1045\u1040", "ထောင့်ကိုးရာ့ ငါးဆယ်"],
  ["1950", "ထောင့်ကိုးရာ့ ငါးဆယ်"],
  ["\u1041\u1040\u1040\u1040", "တစ်ထောင်"],
  ["\u1041\u1040\u1045\u1040", "ထောင့် ငါးဆယ်"],
  ["\u1042\u1040\u1042\u1044", "နှစ်ထောင့်နှစ်ဆယ့်လေး"],
  ["0", "သုည"],
  ["\u1041\u1040", "တစ်ဆယ်"],
  ["\u1041\u1040\u1041", "တစ်ရာ့တစ်"],
  ["1,950", "ထောင့်ကိုးရာ့ ငါးဆယ်"]
];

for (const [input, expected] of spelloutCases) {
  assert.equal(spelloutBurmeseNumberToken(input), expected, input);
}

const skipCases = [
  "\u1041.\u1045",
  "\u1041/\u1045/\u1042\u1040\u1042\u1044",
  "09:30",
  "A-123",
  "\u1040\u1049\u1041\u1042\u1043\u1044\u1045\u1046\u1047\u1048\u1049"
];
for (const input of skipCases) {
  assert.equal(expandBurmeseNumberTokens(input).normalizedScript, input, input);
}

const sourceNumber = "\u1041\u1049\u1045\u1040";
const result = normalizeBurmeseScript(`စာမျက်နှာ ${sourceNumber}။`, [], "test-revision");
assert.equal(result.normalizedScript, "စာမျက်နှာ ထောင့်ကိုးရာ့ ငါးဆယ်။");
assert.equal(JSON.stringify(result.changes), JSON.stringify([
  {
    source: sourceNumber,
    spoken: "ထောင့်ကိုးရာ့ ငါးဆယ်",
    reason: "Myanmar number spellout"
  }
]));

const lexiconEntries = [
  { source: "အံ့သြ", spoken: "အံအော", note: "test" },
  { source: "ရိုးအ", spoken: "ရိုးအ,", note: "test" }
];
const lexiconResult = applyBurmeseLexiconEntries("အံ့သြစရာ ရိုးအ ဖြစ်နေပြီ။ ရိုးအ, ဖြစ်ပြီးသား။", lexiconEntries);
assert.equal(lexiconResult.normalizedScript, "အံအောစရာ ရိုးအ, ဖြစ်နေပြီ။ ရိုးအ, ဖြစ်ပြီးသား။");

console.log("Burmese number spellout tests passed.");
