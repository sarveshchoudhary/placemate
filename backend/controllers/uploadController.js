import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../config/aws.js";
import { v4 as uuidv4 } from "uuid";

export const uploadFile = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `uploads/${uuidv4()}-${file.originalname}`;

    await s3.send(new PutObjectCommand({
      Bucket: "placemate-uploads",
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype
    }));

    const fileUrl = `https://placemate-uploads.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    res.json({ url: fileUrl });

  } catch (err) {
    console.error("S3 upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};