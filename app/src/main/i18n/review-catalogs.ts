// A template reviewed as Grok Bot reviews one (template-review.ts).
export const reviewZh = {
  "template.review.context": "內容",
  "template.review.skills": "技能",
  "template.review.skill": "技能",
  "template.review.routines": "例行工作",
  "template.review.routinesMore": "{p0} 和另外 {p1} 個",
  "template.review.integrations": "整合",
  "template.review.description": "說明",
  "template.review.content": "內容",
  "template.review.firesOn": "觸發方式",
  "template.review.startsPaused": "匯入後先暫停，打開才會執行。",
  "template.review.back": "返回",
} as const;
export const reviewEn: Record<keyof typeof reviewZh, string> = {
  "template.review.context": "Context", "template.review.skills": "Skills", "template.review.skill": "Skill",
  "template.review.routines": "Routines", "template.review.routinesMore": "{p0} and {p1} other", "template.review.integrations": "Integrations",
  "template.review.description": "Description", "template.review.content": "Content",
  "template.review.firesOn": "Fires on", "template.review.startsPaused": "Starts paused after import; it runs once turned on.",
  "template.review.back": "Back",
};
export const reviewJa: Record<keyof typeof reviewZh, string> = {
  "template.review.context": "コンテキスト", "template.review.skills": "スキル", "template.review.skill": "スキル",
  "template.review.routines": "ルーティン", "template.review.routinesMore": "{p0} ほか {p1} 件", "template.review.integrations": "連携",
  "template.review.description": "説明", "template.review.content": "内容",
  "template.review.firesOn": "実行タイミング", "template.review.startsPaused": "インポート後は停止中で、オンにすると動きます。",
  "template.review.back": "戻る",
};
