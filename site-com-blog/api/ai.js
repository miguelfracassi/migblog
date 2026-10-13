import { isAdmin, send } from './_db.js';

const SYSTEM = `Você é o Bup, o assistente de escrita do blog do Miguel Fracassi (influenciador e desenvolvedor, fundador do Grupo Ticord).
Escreva em português do Brasil, com linguagem clara, humana e natural.
Regras:
- Nunca use travessão (—) nem meia-risca (–). Use vírgula, ponto ou dois-pontos.
- Não invente fatos, números, nomes, datas ou links que o autor não informou.
- Se o autor não deu título, crie um título curto e chamativo.
- No texto, separe parágrafos com uma linha em branco. Títulos de seção, se fizerem sentido, começam com "## ".
Responda SOMENTE com um JSON válido neste formato:
{"title": string (até 80 caracteres), "summary": string (1 ou 2 frases, até 200 caracteres), "body": string, "category": string (1 ou 2 palavras), "tags": string[] (de 3 a 6 tags curtas, minúsculas)}`;

const cut = (v, n = 3000) => String(v ?? '').trim().slice(0, n);
const noDash = (s) => String(s ?? '').replace(/[ \t]*[—–][ \t]*/g, ', ');
const SIZE = { curto: 'cerca de 200 palavras', médio: 'cerca de 450 palavras', medio: 'cerca de 450 palavras', longo: 'cerca de 800 palavras' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido' });
  if (!isAdmin(req)) return send(res, 401, { error: 'Senha incorreta' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return send(res, 500, { error: 'A chave GROQ_API_KEY não está configurada na Vercel.' });

  const b = req.body || {};
  let user;
  if (b.mode === 'revise') {
    const c = b.current || {};
    user = `Aqui está o post atual (JSON):
${JSON.stringify({ title: cut(c.title, 200), summary: cut(c.summary, 500), body: cut(c.body, 12000), category: cut(c.category, 60), tags: cut(c.tags, 200) })}

Pedido de mudança do autor: ${cut(b.instruction, 600)}

Aplique o pedido e devolva o post completo no mesmo formato JSON.`;
  } else {
    const a = b.answers || {};
    const t = cut(a.title, 200);
    const wantsSuggestion = !t || /^sugira$/i.test(t);
    user = `Crie um post de blog com estas informações do autor:
- Título: ${wantsSuggestion ? 'o autor não tem título, sugira um' : `use exatamente "${t}"`}
- Assunto: ${cut(a.topic)}
- Pontos importantes: ${cut(a.details) || 'nenhum informado'}
- Tom: ${cut(a.tone, 40) || 'descontraído'}
- Tamanho: ${SIZE[cut(a.size, 20).toLowerCase()] || SIZE.médio}
- Fotos que o post terá: ${Number(a.photoCount) || 0}${a.photoDesc ? `. O que aparece nelas: ${cut(a.photoDesc, 500)}` : ''}`;
  }

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = r.status === 429 ? 'A IA está com muitos pedidos agora. Tente de novo em instantes.' : j?.error?.message || `Erro da IA (${r.status})`;
      return send(res, 502, { error: msg });
    }
    let out;
    try {
      out = JSON.parse(String(j.choices?.[0]?.message?.content || '').replace(/^```(?:json)?|```$/g, '').trim());
    } catch {
      return send(res, 502, { error: 'A IA respondeu em um formato estranho. Tente de novo.' });
    }
    const tags = Array.isArray(out.tags) ? out.tags : String(out.tags || '').split(',');
    return send(res, 200, {
      title: noDash(out.title).slice(0, 140),
      summary: noDash(out.summary).slice(0, 400),
      body: noDash(out.body),
      category: noDash(out.category).slice(0, 40),
      tags: tags.map((x) => noDash(x).trim().toLowerCase()).filter(Boolean).slice(0, 6),
    });
  } catch (e) {
    console.error(e);
    return send(res, 502, { error: 'Não consegui falar com a IA agora.' });
  }
}
