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
    const { name, score } = req.body;

    await db.collection("scores").add({
      name,
      score,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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