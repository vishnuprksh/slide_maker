const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SLIDES_DIR = path.join(__dirname, 'slides');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/slides', express.static(SLIDES_DIR));

// Ensure slides directory exists on startup
fs.mkdir(SLIDES_DIR, { recursive: true }).catch(() => {});

// ─── OpenRouter helper ────────────────────────────────────────────────────────
async function callOpenRouter(apiKey, model, messages, stream = false) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `http://localhost:${PORT}`,
      'X-Title': 'SlideMaker AI',
    },
    body: JSON.stringify({ model, messages, stream }),
  });
  return response;
}

// ─── Intelligent chat / plan router ──────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, model, apiKey, hasPlan } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  const systemPrompt = `You are SlideMaker AI — an intelligent assistant that creates stunning presentations.

Analyse the user's message and decide what they need. Respond with ONLY valid JSON in one of these two formats:

1. If the user is asking you to create, build, generate, or make a presentation/slides about a topic:
{
  "type": "plan",
  "plan": {
    "title": "Presentation Title",
    "theme": "Describe the visual theme in detail (colors, style, mood, era, inspiration)",
    "colorScheme": "primary: #hex, secondary: #hex, accent: #hex, bg: #hex, text: #hex",
    "designSystem": {
      "moodBoard": "3–5 adjectives capturing the visual personality (e.g. bold, futuristic, minimal, warm, editorial)",
      "typography": "Font stack and size scale: display ~64px ultra-bold, heading ~40px semibold, subheading ~28px medium, body ~20px regular, caption ~13px. Describe character (geometric sans, humanist, slab-serif, etc.)",
      "spacing": "Slide padding and internal rhythm (e.g. 72px slide padding, 40px section gap, 16px item gap, 8px tight gap)",
      "animationStyle": "CSS animation style to use consistently: e.g. 'subtle fade-up 0.4s ease, staggered children 0.1s delay each'",
      "visualMotifs": "Recurring decorative elements across all slides: e.g. 'thin horizontal rule accents, circular blobs, diagonal slashes, corner notches, dot-grid patterns'",
      "componentPatterns": "How bullets, callouts, data blocks, tags, and quotes are styled (e.g. 'bullets use left accent bar, callouts use glass morphism card, quotes use large italic with decorative quotemark')",
      "layoutPrinciples": "Core layout rules to maintain consistency (e.g. 'content always left-aligned, hero text left 1/3, visuals right 2/3, never center-align body text')"
    },
    "slides": [
      {
        "id": 1,
        "title": "Slide Title",
        "type": "title|intro|content|section|comparison|data|timeline|quote|closing",
        "description": "What this slide covers — the topic and key idea in 1–2 sentences",
        "layout": "Spatial layout descriptor: e.g. 'full-bleed hero with centered text overlay', 'two-column: text left, visual right', 'three-card horizontal grid', 'timeline vertical flow', 'quote centered with decorative background'",
        "contentStrategy": "Why this slide exists and what the audience should feel or understand after seeing it",
        "keyPoints": ["Concrete bullet 1", "Concrete bullet 2", "Concrete bullet 3"],
        "visualElements": "Specific visual instructions: icon style, shape composition, gradient direction, data viz type, accent colors, SVG art hints",
        "notes": "Any extra design or content nuance for this slide"
      }
    ]
  }
}
Create 8–15 slides. Be specific and creative. Vary types and layouts. The designSystem must be internally consistent and all slides must feel like one cohesive deck.

2. For ALL other messages — greetings, questions, unclear requests, small talk, capability questions, requests for clarification — respond conversationally:
{
  "type": "chat",
  "message": "Your helpful conversational reply here. Use HTML for formatting if needed."
}

Examples:
- "hi" → type: chat
- "what can you do?" → type: chat  
- "create a deck on climate change" → type: plan
- "make slides about machine learning" → type: plan
- "thanks" → type: chat
- "can you help me?" → type: chat (ask what topic they want)`;

  try {
    const response = await callOpenRouter(apiKey, model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ]);

    if (!response.ok) {
      const err = await response.text();
      return res.status(400).json({ error: `OpenRouter error: ${err}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: treat as a plain chat reply
      return res.json({ type: 'chat', message: content || 'Sorry, I didn\'t understand that. Try asking me to create a presentation on a topic!' });
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate slide plan (legacy, keep for compatibility) ─────────────────────
app.post('/api/generate-plan', async (req, res) => {
  const { message, model, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  try {
    const response = await callOpenRouter(apiKey, model, [
      {
        role: 'system',
        content: `You are a world-class presentation designer. When given a topic or request, produce a detailed slide plan as valid JSON only.

Return ONLY this JSON structure (no markdown, no extra text):
{
  "title": "Presentation Title",
  "theme": "Describe the visual theme in detail (colors, style, mood)",
  "colorScheme": "primary: #hex, secondary: #hex, accent: #hex, bg: #hex, text: #hex",
  "slides": [
    {
      "id": 1,
      "title": "Slide Title",
      "type": "title|intro|content|section|comparison|data|timeline|quote|closing",
      "description": "Detailed description of slide content and layout",
      "keyPoints": ["bullet point 1", "bullet point 2", "bullet point 3"],
      "notes": "Design and visual notes for this specific slide"
    }
  ]
}

Create 8–15 slides. Be specific, creative, and vary the slide types.`,
      },
      { role: 'user', content: message },
    ]);

    if (!response.ok) {
      const err = await response.text();
      return res.status(400).json({ error: `OpenRouter error: ${err}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(400).json({ error: 'No valid JSON in response', raw: content });
    }

    const plan = JSON.parse(jsonMatch[0]);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate a single slide (streaming) ─────────────────────────────────────
app.post('/api/generate-slide', async (req, res) => {
  const { slide, theme, colorScheme, designSystem, model, apiKey, presentationTitle } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const ds = designSystem || {};

  try {
    const response = await callOpenRouter(
      apiKey,
      model,
      [
        {
          role: 'system',
          content: `You are an expert HTML/CSS slide designer crafting a single slide for a cohesive professional presentation.

STRICT REQUIREMENTS:
- Return ONLY a complete valid HTML document (<!DOCTYPE html> … </html>)
- Slide dimensions: exactly 1280px × 720px (16:9). Set width/height on body/html.
- Use ONLY inline styles or <style> tags. Zero external CSS files or fonts (no Google Fonts).
- Zero external image URLs. Use CSS gradients, shapes, clip-path, SVG inline, and CSS art.
- Text must be legible. Use good contrast. No tiny fonts.
- CSS animations are encouraged but must not rely on external JS.
- Do NOT include any JavaScript that fetches external resources.
- Make it visually stunning. Be bold and creative.

GLOBAL DESIGN SYSTEM — apply these consistently across this slide:
- Theme: ${theme}
- Color scheme: ${colorScheme}
- Mood: ${ds.moodBoard || 'professional, modern'}
- Typography: ${ds.typography || 'clean sans-serif, display large, body regular'}
- Spacing: ${ds.spacing || '72px slide padding, 40px section gap, 16px item gap'}
- Animations: ${ds.animationStyle || 'subtle fade-in'}
- Visual motifs: ${ds.visualMotifs || 'geometric accents'}
- Component patterns: ${ds.componentPatterns || 'standard card style'}
- Layout principles: ${ds.layoutPrinciples || 'content left-aligned'}
- Presentation: "${presentationTitle}"`,
        },
        {
          role: 'user',
          content: `Create slide ${slide.id} of ${slide.totalSlides || '?'} for "${presentationTitle}":

Title: "${slide.title}"
Type: ${slide.type}
Layout: ${slide.layout || 'Follow design system'}
Content: ${slide.description}
Content strategy (why this slide matters): ${slide.contentStrategy || slide.description}
Key points:
${(slide.keyPoints || []).map(p => `  • ${p}`).join('\n')}
Visual elements: ${slide.visualElements || slide.notes || 'Follow design system'}
Extra notes: ${slide.notes || '—'}

IMPORTANT: This is slide ${slide.id} in the deck. The visual style must match the global design system exactly — same color palette, same typography scale, same motifs, same component patterns.

Return ONLY the complete HTML document.`,
        },
      ],
      true
    );

    if (!response.ok) {
      const err = await response.text();
      send({ type: 'error', message: `OpenRouter error: ${err}` });
      return res.end();
    }

    let htmlContent = '';
    const decoder = new TextDecoder();

    for await (const chunk of response.body) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            htmlContent += token;
            send({ type: 'chunk', content: token, chars: htmlContent.length });
          }
        } catch {}
      }
    }

    const match = htmlContent.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
    const finalHtml = match ? match[0] : wrapHtml(htmlContent, slide.title);

    await fs.writeFile(path.join(SLIDES_DIR, `slide-${slide.id}.html`), finalHtml, 'utf8');
    send({ type: 'done', slideId: slide.id, html: finalHtml });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }

  res.end();
});

// ─── Edit slide with AI (streaming) ──────────────────────────────────────────
app.post('/api/edit-slide', async (req, res) => {
  const { slideId, instruction, currentHtml, model, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const response = await callOpenRouter(
      apiKey,
      model,
      [
        {
          role: 'system',
          content:
            'You are a precise HTML/CSS editor. Apply the requested changes to the slide and return ONLY the complete modified HTML document (<!DOCTYPE html> … </html>). Preserve all existing styles unless the instruction requires changing them.',
        },
        {
          role: 'user',
          content: `Current slide HTML:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nChange request: ${instruction}\n\nReturn only the complete modified HTML document.`,
        },
      ],
      true
    );

    if (!response.ok) {
      const err = await response.text();
      send({ type: 'error', message: err });
      return res.end();
    }

    let htmlContent = '';
    const decoder = new TextDecoder();

    for await (const chunk of response.body) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            htmlContent += token;
            send({ type: 'chunk', content: token, chars: htmlContent.length });
          }
        } catch {}
      }
    }

    const match = htmlContent.match(/<!DOCTYPE html>[\s\S]*<\/html>/i);
    const finalHtml = match ? match[0] : currentHtml;

    await fs.writeFile(path.join(SLIDES_DIR, `slide-${slideId}.html`), finalHtml, 'utf8');
    send({ type: 'done', slideId, html: finalHtml });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }

  res.end();
});

// ─── Slide CRUD ───────────────────────────────────────────────────────────────
app.get('/api/slides', async (req, res) => {
  try {
    const files = await fs.readdir(SLIDES_DIR);
    const slides = files
      .filter((f) => /^slide-\d+\.html$/.test(f))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
      .map((f) => ({ id: parseInt(f.match(/\d+/)[0]), file: f }));
    res.json(slides);
  } catch {
    res.json([]);
  }
});

app.get('/api/slide/:id', async (req, res) => {
  try {
    const html = await fs.readFile(path.join(SLIDES_DIR, `slide-${req.params.id}.html`), 'utf8');
    res.json({ html });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

app.delete('/api/slides', async (req, res) => {
  try {
    const files = await fs.readdir(SLIDES_DIR);
    await Promise.all(
      files.filter((f) => f.endsWith('.html')).map((f) => fs.unlink(path.join(SLIDES_DIR, f)))
    );
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function wrapHtml(content, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1280px;height:720px;overflow:hidden}</style>
</head>
<body>${content}</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`\n🎨 SlideMaker AI → http://localhost:${PORT}\n`);
});
