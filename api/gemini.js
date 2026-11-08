import { GoogleGenAI } from '@google/genai';

// .env.local / Vercel 환경변수의 GEMINI_API_KEY를 사용합니다.
// 처음 호출될 때 만들어서, 키가 없어도 배포 자체는 실패하지 않게 했어요.
let ai = null;
const client = () => (ai ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

export async function analyzeWaterMeter(imageBase64, userPrompt) {
  try {
    const response = await client().models.generateContent({
      model: 'gemini-2.5-flash', // 빠르고 이미지 처리에 뛰어난 최신 모델
      contents: [
        {
          inlineData: {
            mimeType: 'image/jpeg', // 업로드된 이미지 형식
            data: imageBase64,      // 사진의 Base64 데이터
          },
        },
        {
          text: userPrompt || "이 캘거리 수도 계량기 사진을 분석해서 현재 지침(숫자)과 상태를 알려줘.",
        },
      ],
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API 호출 중 오류 발생:", error);
    throw error;
  }
}

// Vercel 서버 함수: POST /api/gemini  { image: "<base64>", prompt?: "..." } → { text }
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "GEMINI_API_KEY is not set" });
  try {
    const { image, prompt } = req.body || {};
    if (!image || typeof image !== "string") return res.status(400).json({ error: "image (base64) is required" });
    if (image.length > 4_000_000) return res.status(413).json({ error: "Image too large (max ~3 MB)" });
    return res.status(200).json({ text: await analyzeWaterMeter(image, prompt) });
  } catch (e) {
    return res.status(502).json({ error: "Gemini request failed" });
  }
}
