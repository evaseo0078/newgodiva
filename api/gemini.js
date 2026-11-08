import { GoogleGenAI } from '@google/genai';

// .env.local에 넣어둔 GEMINI_API_KEY를 자동으로 인식합니다.
const ai = new GoogleGenAI();

export async function analyzeWaterMeter(imageBase64, userPrompt) {
  try {
    const response = await ai.models.generateContent({
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
