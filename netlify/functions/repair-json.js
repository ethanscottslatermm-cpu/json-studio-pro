const { Octokit } = require("@octokit/rest");
// This allows the function to call the AI engine
const { GoogleGenerativeAI } = require("@google/generative-ai"); 

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { filePath, content, sha, instruction } = JSON.parse(event.body);
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // 1. AI ENGINE PHASE: Fixing the code
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Fix this JSON based on this instruction: "${instruction}". 
                    Return ONLY the raw fixed JSON code.\n\n${content}`;
    
    const aiResult = await model.generateContent(prompt);
    const fixedContent = aiResult.response.text();

    // 2. PERSISTENCE PHASE: Writing to GitHub
    await octokit.repos.createOrUpdateFileContents({
      owner: "ethanscottslatermm-cpu",
      repo: "json-studio-pro",
      path: filePath,
      message: "AI-Engine: Automatically repaired JSON structure",
      content: Buffer.from(fixedContent).toString("base64"),
      sha: sha,
    });

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "AI repaired and saved the file!", fixedContent }) 
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
