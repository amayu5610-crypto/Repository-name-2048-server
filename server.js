const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { createClient } = require("@supabase/supabase-js");

// ===== Firebase Admin初期化 =====
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ===== Supabase初期化（service_role_keyで全テーブル書き込み可） =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

app.use(cors({
  origin: "https://amayu5610-crypto.github.io"
}));

app.use(express.json());

// ===== Firebase IDトークン検証ヘルパー =====
async function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    return await admin.auth().verifyIdToken(auth.replace("Bearer ", ""));
  } catch {
    return null;
  }
}

// ===== スコア保存API =====
app.post("/save-score", async (req, res) => {
  try {
    const { score, mode, playTime, moveCount, maxTile, moves } = req.body;

    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];

    // ===== 不正チェック =====
    if (!score || score < 0)
      return res.status(400).json({ success: false, error: "invalid score" });
    if (score > 1000000)
      return res.status(400).json({ success: false, error: "score too high" });
    if (playTime && playTime < 5 && score > 1000)
      return res.status(400).json({ success: false, error: "too fast" });
    if (moveCount && moveCount < 10 && score > 5000)
      return res.status(400).json({ success: false, error: "too few moves" });

    // ===== Firebase IDトークン検証 =====
    const decoded = await verifyToken(req);

    if (decoded) {
      const uid = decoded.uid;
      const safeMode = mode || "normal";

      // 既存スコアを確認してベストスコアのみupsert
      const { data: existing } = await supabase
        .from("scores")
        .select("score")
        .eq("uid", uid)
        .eq("mode", safeMode)
        .single();

      if (!existing || score > (existing.score || 0)) {
        const { data: player } = await supabase
          .from("players")
          .select("game_name")
          .eq("uid", uid)
          .single();

        await supabase.from("scores").upsert({
          id: `${uid}_${safeMode}`,
          uid,
          game_name: player?.game_name || "名無し",
          mode: safeMode,
          score,
          updated_at: new Date().toISOString()
        });
      }
    }

    // Firestoreに履歴ログを保存（不正検知用）
    await db.collection("history2048").add({
      uid: decoded?.uid || null,
      score,
      mode: mode || "normal",
      playTime: playTime || null,
      moveCount: moveCount || null,
      maxTile: maxTile || null,
      ip,
      userAgent,
      suspicious: false,
      updated_at: new Date().toISOString()
    });

    res.json({ success: true });

  } catch (err) {
    console.error("保存エラー:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== ニックネーム保存API =====
app.post("/save-nickname", async (req, res) => {
  try {
    const decoded = await verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, error: "認証が必要です" });

    const uid = decoded.uid;
    const { gameName } = req.body;

    if (!gameName || gameName.trim().length === 0 || gameName.trim().length > 12)
      return res.status(400).json({ success: false, error: "ニックネームが無効です" });

    const trimmed = gameName.trim();
    const nameId = trimmed.toLowerCase().replace(/\s+/g, "_");

    // 重複チェック（自分以外が同じnameIdを持っていないか）
    const { data: existing } = await supabase
      .from("user_names")
      .select("uid")
      .eq("name_id", nameId)
      .single();

    if (existing && existing.uid !== uid)
      return res.status(409).json({ success: false, error: "このニックネームはすでに使われています。" });

    // user_namesに保存
    await supabase.from("user_names").upsert({
      name_id: nameId,
      uid,
      game_name: trimmed,
      updated_at: new Date().toISOString()
    });

    // playersに保存
    await supabase.from("players").upsert({
      uid,
      game_name: trimmed,
      google_name: decoded.name || "",
      email: decoded.email || "",
      updated_at: new Date().toISOString()
    });

    // scoresのgame_nameも更新
    await supabase
      .from("scores")
      .update({ game_name: trimmed })
      .eq("uid", uid);

    res.json({ success: true });

  } catch (err) {
    console.error("ニックネーム保存エラー:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 統計・履歴・アチーブメント保存API =====
app.post("/save-stats", async (req, res) => {
  try {
    const decoded = await verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, error: "認証が必要です" });

    const uid = decoded.uid;
    const { statsData, historyItem, achievements } = req.body;

    // 統計の保存
    if (statsData) {
      const { data: row } = await supabase.from("stats").select("data").eq("uid", uid).single();
      const remote = row?.data || {};
      const m = statsData.mode;

      if (!remote[m]) remote[m] = { bestScore: 0, playCount: 0, maxTile: 0, bestTime: 0 };
      remote[m].playCount = (remote[m].playCount || 0) + 1;
      if (statsData.score > (remote[m].bestScore || 0)) remote[m].bestScore = statsData.score;
      if ((statsData.maxTile || 0) > (remote[m].maxTile || 0)) remote[m].maxTile = statsData.maxTile;
      if (statsData.bestTime && statsData.bestTime > (remote[m].bestTime || 0)) remote[m].bestTime = statsData.bestTime;

      await supabase.from("stats").upsert({ uid, data: remote, updated_at: new Date().toISOString() });

      // アチーブメントも一緒に保存
      if (Array.isArray(statsData.unlocked)) {
        await supabase.from("achievements").upsert({ uid, unlocked: statsData.unlocked, updated_at: new Date().toISOString() });
      }
    }

    // 履歴の保存
    if (historyItem) {
      const { data: row } = await supabase.from("history").select("entries").eq("uid", uid).single();
      const remote = row?.entries || [];
      const merged = [historyItem, ...remote].slice(0, 50);
      await supabase.from("history").upsert({ uid, entries: merged, updated_at: new Date().toISOString() });
    }

    // アチーブメント単体保存（syncAchievementsToSupabase用）
    if (achievements && !statsData) {
      await supabase.from("achievements").upsert({ uid, unlocked: achievements, updated_at: new Date().toISOString() });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("統計保存エラー:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 動作確認 =====
app.get("/", (req, res) => {
  res.send("2048 Server OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
