const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  try {
    const body = JSON.parse(event.body);
    
    // Initialize Gemini using your existing Netlify Environment Variable
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Extract the latest message from the app's request
    const userPrompt = body.messages[body.messages.length - 1].content;

    // Generate response using Gemini
    const result = await model.generateContent(userPrompt);
    const responseText = result.response.text();

    // Map the response back to the format your App expects
    const formattedData = {
      content: [
        {
          text: responseText
        }
      ]
    };

    console.log('Gemini response generated successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formattedData),
    };
  } catch (err) {
    console.error('Gemini Function error:', err.message);
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
