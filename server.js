const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors({
  origin: "https://amayu5610-crypto.github.io"
}));

// Firebase Admin初期化（環境変数から読み込む）
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  })
});

const db = admin.firestore();

// ===== 2048ゲームロジック（サーバー側で再現） =====
function slide(row) {
  const filtered = row.filter(n => n !== 0);
  let score = 0;
  const result = [];
  for (let i = 0; i < filtered.length; i++) {
    if (i < filtered.length - 1 && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2;
      score += merged;
      result.push(merged);
      i++;
    } else {
      result.push(filtered[i]);
    }
  }
  while (result.length < row.length) result.push(0);
  return { row: result, score };
}

function applyMove(board, direction) {
  const size = board.length;
  let totalScore = 0;

  const moveLeft = (b) => {
    let s = 0;
    const nb = b.map(row => {
      const { row: r, score } = slide(row);
      s += score;
      return r;
    });
    return { board: nb, score: s };
  };

  const rotate90 = (b) => b[0].map((_, i) => b.map(row => row[i]).reverse());
  const rotate180 = (b) => rotate90(rotate90(b));
  const rotate270 = (b) => rotate90(rotate90(rotate90(b)));

  let result;
  if (direction === "L") result = moveLeft(board);
  else if (direction === "R") { const r = moveLeft(rotate180(board)); result = { board: rotate180(r.board), score: r.score }; }
  else if (direction === "U") { const r = moveLeft(rotate270(board)); result = { board: rotate90(r.board), score: r.score }; }
  else if (direction === "D") { const r = moveLeft(rotate90(board)); result = { board: rotate270(r.board), score: r.score }; }
  else return { board, score: 0 };

  totalScore += result.score;
  return { board: result.board, score: totalScore };
}

// ===== スコア検証エンドポイント =====
app.post("/api/save-score", async (req, res) => {
  const { uid, token, mode, score, moves, randoms, size } = req.body;

  // ① Firebase Auth でトークン検証
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (e) {
    return res.status(401).json({ error: "認証エラー" });
  }

  if (decodedToken.uid !== uid) {
    return res.status(403).json({ error: "UID不一致" });
  }

  // ② ゲームを再現してスコアを計算
  const boardSize = size || 4;
  let board = Array.from({ length: boardSize }, () => Array(boardSize).fill(0));
  let calcScore = 0;

  // ランダムタイル配置を再現
  if (!randoms || !moves) {
    return res.status(400).json({ error: "データ不足" });
  }

  // 最初の2つのタイルを配置
  for (let i = 0; i < Math.min(2, randoms.length); i++) {
    const { r, c, value } = randoms[i];
    if (board[r] && board[r][c] !== undefined) board[r][c] = value;
  }

  let randomIndex = 2;

  // 各手を再現
  for (const move of moves) {
    const before = JSON.stringify(board);
    const result = applyMove(board, move);
    board = result.board;
    calcScore += result.score;

    // 盤面が変わった場合のみタイルを追加
    if (before !== JSON.stringify(board) && randomIndex < randoms.length) {
      const { r, c, value } = randoms[randomIndex];
      if (board[r] && board[r][c] !== undefined) board[r][c] = value;
      randomIndex++;
    }
  }

  // ③ スコア検証（±5%の誤差を許容）
  const tolerance = Math.max(100, score * 0.05);
  if (Math.abs(calcScore - score) > tolerance) {
    console.log(`スコア不一致: 申告=${score}, 計算=${calcScore}`);
    return res.status(400).json({ error: "スコア不一致", calc: calcScore, claimed: score });
  }

  // ④ Firestoreに保存
  try {
    const docId = `${uid}_${mode}`;
    const existing = await db.collection("scores2048").doc(docId).get();

    if (!existing.exists || score > (existing.data().score || 0)) {
      // プレイヤー名を取得
      const playerDoc = await db.collection("players2048").doc(uid).get();
      const gameName = playerDoc.exists ? (playerDoc.data().game_name || "名無し") : "名無し";

      await db.collection("scores2048").doc(docId).set({
        uid,
        game_name: gameName,
        mode,
        score,
        updated_at: new Date().toISOString()
      });

      return res.json({ success: true, message: "スコアを保存しました", score });
    } else {
      return res.json({ success: true, message: "既存のスコアの方が高いため更新しませんでした" });
    }
  } catch (e) {
    console.error("Firestore保存エラー:", e);
    return res.status(500).json({ error: "保存エラー" });
  }
});

// ===== ランキング取得エンドポイント =====
app.get("/api/ranking/:mode", async (req, res) => {
  const { mode } = req.params;
  try {
    const snap = await db.collection("scores2048")
      .where("mode", "==", mode)
      .orderBy("score", "desc")
      .limit(10)
      .get();

    const ranking = snap.docs.map(d => ({
      gameName: d.data().game_name || "名無し",
      score: d.data().score,
      mode
    }));

    res.json({ ranking });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.send("2048 Server OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
