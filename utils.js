const firebaseAdmin = require("firebase-admin");

function getPathFromFirebaseStorageUrl(url) {
  console.log("Parsing URL:", url)
  const parsedUrl = new URL(url);

  let path = parsedUrl.pathname.slice(1);
  console.log("Path", path)

  const firstSlashIndex = path.indexOf('/');
  if (firstSlashIndex !== -1) {
    path = path.slice(firstSlashIndex + 1); // Get the path after the first "/"
  }

  return path;
}

function extractToken(req, res) {
  const authorizationHeader = req.headers["authorization"];

  if (!authorizationHeader) {
    throw new Error("Unauthorized - Missing Authorization header")
  }

  const [bearer, token] = authorizationHeader.split(" ");

  if (bearer.toLowerCase() !== "bearer" || !token) {
    throw new Error("Unauthorized - Invalid Authorization header")
  }

  console.log("Bearer token:", JSON.stringify(token));

  return token;
}

async function verifyToken(token) {
  return firebaseAdmin
    .auth()
    .verifyIdToken(token)
    .then((decodedToken) => {
      return decodedToken.uid
      // if (decodedToken.email_verified) {
      //   return decodedToken.uid;
      // } else {
      //   throw new ForbiddenError("Email has not been verified!!")
      // }
    })
    .catch((error) => {
      throw new UnauthorizedError("Unauthorized - Error decoding token")
    })
}

module.exports = {
  verifyToken,
  extractToken,
  getPathFromFirebaseStorageUrl
};
