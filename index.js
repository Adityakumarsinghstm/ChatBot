require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PRODUCTS_API = process.env.PRODUCTS_API_URL;
const PORT = process.env.PORT || 5000;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in environment variables");
  process.exit(1);
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// Product Cache
let productCache = {
  data: [],
  lastUpdated: null,
  ttl: 1000 * 60 * 10 // 10 minutes cache
};

// Fetch Products from External API
async function fetchProducts() {
  try {
    console.log("Fetching fresh products...");
    const response = await fetch(PRODUCTS_API);
    
    if (!response.ok) {
      throw new Error(`Products API failed with status ${response.status}`);
    }

    const data = await response.json();
    
    // Handle different response structures
    const products = data.content || data.products || data.items || data;
    
    if (!Array.isArray(products)) {
      throw new Error("Invalid products data format");
    }

    productCache = {
      data: products,
      lastUpdated: Date.now(),
      ttl: 1000 * 60 * 10
    };

    return products;
  } catch (error) {
    console.error("Product fetch error:", error);
    throw error;
  }
}

// Get Products (with caching)
async function getProducts() {
  try {
    console.log('\n=== STARTING PRODUCT FETCH ===');
    console.log(`Fetching from: ${PRODUCTS_API}`);
    console.log(`Current cache: ${productCache.data.length} products (updated ${productCache.lastUpdated ? new Date(productCache.lastUpdated).toISOString() : 'never'})`);

    // Check cache validity
    if (productCache.data.length > 0 && 
        Date.now() - productCache.lastUpdated < productCache.ttl) {
      console.log('▲ Using cached products ▲');
      return productCache.data;
    }

    // Fresh fetch
    console.log('▼ Fetching fresh products ▼');
    const response = await fetch(PRODUCTS_API);
    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('API Error:', errorBody);
      throw new Error(`Products API failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('Raw API response:', JSON.stringify(data, null, 2));

    // Handle different response structures
    const products = data.content || data.products || data.items || data;
    console.log(`Parsed ${products.length} products`);

    if (!Array.isArray(products)) {
      console.error('Invalid products format:', typeof products);
      throw new Error('Products data is not an array');
    }

    // Update cache
    productCache = {
      data: products,
      lastUpdated: Date.now(),
      ttl: 1000 * 60 * 10 // 10 minutes
    };

    console.log('=== PRODUCT FETCH COMPLETE ===\n');
    return products;

  } catch (error) {
    console.error('\n!!! PRODUCT FETCH FAILED !!!');
    console.error(error.stack);
    throw error;
  }
}

// Generate Context from Products
function buildProductContext(products) {
  return products.map(p => `
    Product: ${p.title || 'Unnamed Product'}
    Description: ${p.description || 'No description'}
    Price: ${p.price || 'N/A'}
    Category: ${p.category || 'Uncategorized'}
  `).join("\n\n");
}

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: "Prompt is required and must be a non-empty string." });
    }

    const products = await getProducts();

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.5
      }
    });

    const constrainedPrompt = `
      [Respond in under 40 words]
      User Query: ${prompt}
      
      Available Products:
      ${buildProductContext(products)}
      
      Response Requirements:
      - Concise bullet points
      - Max 200 tokens
      - Prioritize most relevant products
    `;

    const result = await model.generateContent(constrainedPrompt);
    let response = (await result.response).text();

    res.json({
      response,
      tokenEstimate: response.split(' ').length * 1.33,
      productsUsed: products.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Health Check
app.get("/", (req, res) => {
  res.send("Product Chatbot API is running");
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Products API: ${PRODUCTS_API}`);
});