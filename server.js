const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

const app = express();

app.use(cors({
  origin: "https://amayu5610-crypto.github.io"
}));

app.use(express.json());

// ===== シンプル保存API =====
app.post("/save-score", async (req, res) => {
  try {
    const {
      name,
      score,
      mode,
      playTime,
      moveCount,
      maxTile
    } = req.body;

    const ip =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress;

    const userAgent = req.headers["user-agent"];

    // 不正チェック
    if (!score || score < 0) {
      return res.status(400).json({
        success: false,
        error: "invalid score"
      });
    }

    if (score > 1000000) {
      return res.status(400).json({
        success: false,
        error: "score too high"
      });
    }

    if (playTime && playTime < 5 && score > 1000) {
      return res.status(400).json({
        success: false,
        error: "too fast"
      });
    }

    if (moveCount && moveCount < 10 && score > 5000) {
      return res.status(400).json({
        success: false,
        error: "too few moves"
      });
    }

    await db.collection("scores").add({
      name,
      score,
      mode: mode || "normal",
      playTime: playTime || null,
      moveCount: moveCount || null,
      maxTile: maxTile || null,
      ip,
      userAgent,
      suspicious: false,
      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });

  } catch (err) {
    console.error("保存エラー:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });
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