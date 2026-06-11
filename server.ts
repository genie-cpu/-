import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// JSON Limit set to 50MB for high-res PDF base64 handling
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// Error checking health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: !!apiKey,
  });
});

// Primary Endpoint: Score Analysis from PDF
app.post("/api/analyze-score", async (req, res): Promise<any> => {
  try {
    const { base64, fileName, mimeType = "application/pdf" } = req.body;

    if (!base64) {
      return res.status(400).json({ error: "Base64 input code is required." });
    }

    if (!ai) {
      return res.status(500).json({
        error: "Gemini API key is not configured inside server secrets.",
      });
    }

    // Prepare PDF document part
    const pdfPart = {
      inlineData: {
        data: base64,
        mimeType: mimeType,
      },
    };

    const promptText = `Provide expert music transcription. Please analyze the attached choral score PDF (typically featuring Soprano, Alto, Tenor, and Bass parts across multiple pages).
CRITICAL: The uploaded PDF typically contains multiple pages (for example, page 1 and page 2). You MUST read and transcribe the entire document, encompassing ALL pages (both Page 1 and Page 2). Do NOT stop after the first page.
1. Read ALL musical notes, key signatures, and tempos from ALL available pages in the document.
2. Carefully transcribe the complete melody lines (note pitches and durations) sequentially from the beginning of Page 1 to the end of Page 2 (or the last page) for each of the four vocal parts: soprano, alto, tenor, and bass.
3. Ensure the duration value represents beat count (e.g., 1.0 is a quarter note, 0.5 is an eighth note, 2.0 is a half note, 4.0 is a whole note, 0.25 is a 16th note). Use standard Rest note "R" for silent points.
4. Transcribe the entire sheet music span completely (e.g., 16-32 or more bars of music from both pages combined) to capture the full song progression, ensuring all parts (soprano, alto, tenor, bass) remain perfectly synchronized and aligned.`;

    // Query Gemini with Retry and Fallback models to prevent 503 high-demand issues
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    
    const config = {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "The title of the song" },
          composer: { type: Type.STRING, description: "The composer or arranger of the song" },
          tempo: { type: Type.INTEGER, description: "Suggested playback speed in BPM (beats per minute)" },
          timeSignature: { type: Type.STRING, description: "Time signature of the song (e.g., '4/4', '3/4', '6/8')" },
          keySignature: { type: Type.STRING, description: "Primary Key signature (e.g., 'C Major', 'G Major', 'F Major', 'A Minor')" },
          parts: {
            type: Type.OBJECT,
            properties: {
              soprano: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "Note Pitch like C4, D4, E#4, G5, F#4 or R for rest" },
                    duration: { type: Type.NUMBER, description: "Duration in beats (e.g., 1.0, 0.5, 2.0, 4.0)" }
                  },
                  required: ["note", "duration"]
                }
              },
              alto: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "Note Pitch or R for rest" },
                    duration: { type: Type.NUMBER, description: "Duration in beats" }
                  },
                  required: ["note", "duration"]
                }
              },
              tenor: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "Note Pitch or R for rest" },
                    duration: { type: Type.NUMBER, description: "Duration in beats" }
                  },
                  required: ["note", "duration"]
                }
              },
              bass: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    note: { type: Type.STRING, description: "Note Pitch or R for rest" },
                    duration: { type: Type.NUMBER, description: "Duration in beats" }
                  },
                  required: ["note", "duration"]
                }
              }
            },
            required: ["soprano", "alto", "tenor", "bass"]
          }
        },
        required: ["title", "composer", "tempo", "timeSignature", "parts"]
      }
    };

    const modelsToTry = [
      { name: "gemini-3.5-flash", delay: 0 },
      { name: "gemini-3.5-flash", delay: 1500 },
      { name: "gemini-3.1-flash-lite", delay: 3000 },
      { name: "gemini-3.5-flash", delay: 5000 },
      { name: "gemini-3.1-flash-lite", delay: 8000 },
      { name: "gemini-3.5-flash", delay: 12000 }
    ];

    let lastError: any = null;
    let response: any = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const option = modelsToTry[i];
      if (option.delay > 0) {
        console.log(`Waiting ${option.delay}ms before next model attempt (${option.name})...`);
        await sleep(option.delay);
      }
      try {
        console.log(`Attempt ${i + 1}: Querying Gemini using model "${option.name}"`);
        response = await ai.models.generateContent({
          model: option.name,
          contents: [pdfPart, { text: promptText }],
          config
        });
        
        if (response && response.text) {
          console.log(`Gemini query succeeded with model "${option.name}"`);
          lastError = null;
          break;
        } else {
          throw new Error("No text response received from API.");
        }
      } catch (err: any) {
        console.error(`Attempt ${i + 1} with model "${option.name}" failed:`, err.message || err);
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    const outputText = response.text;
    if (!outputText) {
      throw new Error("Empty response received from the Gemini model.");
    }

    const scoreData = JSON.parse(outputText.trim());
    return res.json(scoreData);

  } catch (error: any) {
    console.error("Score analysis failed:", error);
    
    // Check if error is related to 503 / unavailability
    let refinedErrorMessage = "악보 분석 모델 호출 실패. 일반 합창 4부 오선지 그래픽 PDF가 맞는지 확인하고 다시 시도해보세요.";
    const errMsgStr = String(error.message || JSON.stringify(error));
    if (errMsgStr.includes("503") || errMsgStr.includes("UNAVAILABLE") || errMsgStr.includes("high demand")) {
      refinedErrorMessage = "현재 Gemini AI 악보 분석 서비스의 트래픽이 몰려 모델 서버가 일시적으로 지연되고 있습니다. 잠시 후 파일을 다시 업로드해보시거나 다른 PDF 파일을 구동해 보시기 바랍니다. (503 Service Unavailable)";
    } else if (errMsgStr.includes("429") || errMsgStr.includes("RESOURCE_EXHAUSTED")) {
      refinedErrorMessage = "요청 횟수 제한(Rate Limit)을 초과했습니다. 잠시 후 다시 악보를 업로드해 주세요.";
    } else {
      refinedErrorMessage = `악보 해석기 분석 거부 (원인: ${error.message || "Invalid response format"}). \n일반 합창 4부 오선지 그래픽 PDF가 맞는지 확인해보세요.`;
    }

    return res.status(500).json({
      error: refinedErrorMessage,
      details: error.message,
    });
  }
});

// Configure Vite middleware and static files based on execution environment
async function setupExpress() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

setupExpress();
