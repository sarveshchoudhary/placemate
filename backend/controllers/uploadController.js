export const uploadFile = async (req, res) => {
  res.status(501).json({
    error: "File uploads are disabled until a MySQL file-storage table is added"
  });
};
