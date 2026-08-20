// Cloudflare Pages Function: 接收网页编辑内容并写回 GitHub 仓库，触发自动部署
// 部署后在 Pages 项目 Settings → Environment variables 中设置：
//   GH_TOKEN  - 具有该仓库 contents:write 权限的 GitHub Token（建议 fine-grained PAT，设为加密 secret）
//   GH_REPO   - "owner/repo"
//   GH_PATH   - 要更新的文件路径，默认 index.html
//   EDIT_PASS - 必须与前端 SECRET 一致，作为编辑鉴权（建议设为加密 secret）

export async function onRequestPost({ request, env }) {
  const cors = { 'content-type': 'application/json' };
  try {
    const { pass, html } = await request.json();
    if (!pass || pass !== env.EDIT_PASS) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: cors });
    }
    if (typeof html !== 'string' || html.length > 500000) {
      return new Response(JSON.stringify({ ok: false, error: 'bad payload' }), { status: 400, headers: cors });
    }

    const repo = env.GH_REPO;
    const path = env.GH_PATH || 'index.html';
    const api = `https://api.github.com/repos/${repo}/contents/${path}`;
    const headers = {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      'User-Agent': 'cv-sync',
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json'
    };

    // 读取当前文件以获取 sha（GitHub 更新接口需要）
    const cur = await fetch(api, { headers });
    if (!cur.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'repo read failed: ' + cur.status }), { status: 502, headers: cors });
    }
    const data = await cur.json();
    const sha = data.sha;

    // 解码仓库现有文件（Workers 运行时无 Buffer，用 TextDecoder）
    const existing = new TextDecoder().decode(
      Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0))
    );

    // 只替换 EDITABLE 标记之间的内容，保留导航/工具栏/脚本等结构
    const replaced = existing.replace(
      /<!--EDITABLE-START-->[\s\S]*?<!--EDITABLE-END-->/,
      html
    );

    // UTF-8 安全的 base64 编码
    const finalContent = btoa(unescape(encodeURIComponent(replaced)));

    const put = await fetch(api, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: 'Update resume via web edit',
        content: finalContent,
        sha,
        committer: { name: 'CV Sync', email: 'cv-sync@users.noreply.github.com' }
      })
    });
    if (!put.ok) {
      const err = await put.text();
      return new Response(JSON.stringify({ ok: false, error: 'github put failed: ' + err }), { status: 502, headers: cors });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors });
  }
}
