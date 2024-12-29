const firebaseAdmin = require("firebase-admin");

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
};
