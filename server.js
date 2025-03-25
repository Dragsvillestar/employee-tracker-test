const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config();
const crypto = require("crypto"); 

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

function generateCustomID() {
     return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8); 
};

const db = admin.firestore();
const app = express();
app.use(express.json());

// Serve frontend from "www" folder
app.use(express.static(path.join(__dirname, "./www")));
app.set("view engine", "pug"); 
app.set("views", path.join(__dirname, "www/views")); 

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "./www", "index.html"));
});

async function getUserRole(Id) { 
    try {
        let foundUser = null;
        let userPath = null;
        console.log("Registrar ID (type):", typeof Id, Id);

        // 🔍 Step 1: Check in `users2` (App Owner)
        const userQuery = await db.collection("users2").where("uid", "==", Id).get();
        if (!userQuery.empty) {
            foundUser = userQuery.docs[0];
            userPath = foundUser.ref.path;
        } else {
            // 🔍 Step 2: Search in `users2/APP OWNER/admins`
            const adminQuery = await db
                .collection("users2")
                .doc("app_owner")
                .collection("admins")
                .where("uid", "==", Id)
                .get();

            console.log("Admin Query Docs:", adminQuery.docs.map(doc => doc.data()));

            if (!adminQuery.empty) {
                foundUser = adminQuery.docs[0];
                userPath = foundUser.ref.path;
            } else {
                // 🔍 Step 3: Check in `admins/{adminId}/managers`
                const adminsSnapshot = await db
                    .collection("users2")
                    .doc("app_owner")
                    .collection("admins")
                    .get();

                for (const adminDoc of adminsSnapshot.docs) {
                    const managerQuery = await adminDoc.ref
                        .collection("managers")
                        .where("uid", "==", Id)
                        .get();

                    if (!managerQuery.empty) {
                        foundUser = managerQuery.docs[0];
                        userPath = foundUser.ref.path;
                        break; // ✅ Found manager, stop searching
                    }
                }

                // 🔍 Step 4: Check in `managers/{managerId}/workers`
                if (!foundUser) {
                    for (const adminDoc of adminsSnapshot.docs) {
                        const managersSnapshot = await adminDoc.ref
                            .collection("managers")
                            .get();

                        for (const managerDoc of managersSnapshot.docs) {
                            const workerQuery = await managerDoc.ref
                                .collection("workers")
                                .where("uid", "==", Id)
                                .get();

                            if (!workerQuery.empty) {
                                foundUser = workerQuery.docs[0];
                                userPath = foundUser.ref.path;
                                break; // ✅ Found worker, stop searching
                            }
                        }

                        if (foundUser) break; // ✅ Found user, exit outer loop
                    }
                }
            }
        }

        if (!foundUser) {
            console.error(`❌ User '${Id}' not found.`);
            return { success: false, error: "User not found" };
        }

        // ✅ Extract user name and role
        const userData = foundUser.data();
        console.log(`✅ Name: ${userData.fullName}, Role: ${userData.role}, Registrar ID : ${userData.registrarID}, Path: ${userPath}`);

        return { success: true, fullName: userData.fullName, role: userData.role, prevRegistrarId: userData.registrarID, userPath };
    } catch (error) {
        console.error("❌ Error checking role:", error.message);
        return { success: false, error: error.message };
    }
}




app.post("/checkRole", async (req, res) => {
    console.log("Received request to /checkRole:", req.body);
    const { registrarId } = req.body;

    if (!registrarId) {
        console.log("❌ Missing registrarId");
        return res.status(400).json({ success: false, error: "Missing registrar ID" });
    }

    const { role, fullName, prevRegistrarId, error } = await getUserRole(registrarId);

    if (error || !role) {
        console.log("❌ User not found:", error);
        return res.status(404).json({ success: false, error: "User not found or unauthorized" });
    }

    console.log(`✅ User role: ${role}`);
    res.json({ success: true, role, fullName, prevRegistrarId });
});


// 🟢 REGISTER USER (With Custom ID)
async function registerUser(creatorID, fullName, role, company, password, registrarName, prevRegistrarID) {
    try {
        const { role: creatorRole, fullName: creatorName, userPath} = await getUserRole(creatorID);

        if (!creatorRole) {
            return { success: false, error: "Creator not found or unauthorized" };
        }

        const customID = generateCustomID();

        await admin.auth().createUser({
            uid: customID,
            password: password || "Default@123",
        });

        const customToken = await admin.auth().createCustomToken(customID);

        let collectionPath = "";
        let adminPath = "";
        let managerPath = "";
        let registeredBy = ""; 

        if (creatorRole === "app owner") {
            // 🔥 App Owner creates an Admin
            collectionPath = db.collection("users2").doc("app_owner").collection("admins").doc(customID);
        } else if (creatorRole === "admin") {
            // 🔥 Admin creates a Manager
            collectionPath = db.collection("users2").doc("app_owner").collection("admins").doc(creatorID).collection("managers").doc(customID);
            adminPath = db.collection("users2").doc("app_owner").collection("admins").doc(creatorID);
            registeredBy = creatorID;

            // 🔥 Ensure Admin Document Marks That It Has Managers
            await adminPath.set({ hasManagers: true }, { merge: true });
        } else if (creatorRole === "manager") {
            console.log("Path:",userPath);

            // 🔥 Manager Creates Worker
            if (!userPath) {
                return { success: false, error: "Failed to determine manager's path" };
            }

            // 🔥 Create a Worker under the retrieved Admin and Manager
            collectionPath = db.doc(`${userPath}/workers/${customID}`);
            managerPath = db.doc(userPath);
            // 🔥 Ensure Manager Document Marks That It Has Workers
            await managerPath.set({ hasWorkers: true }, { merge: true });
        }

        if (!collectionPath) {
            return { success: false, error: "Invalid collection path" };
        }

        // 🔥 Create the User in Firestore
        await collectionPath.set(
            {
                uid: customID,
                fullName,
                role,
                company,
                registeredBy: registrarName, 
                registrarID: creatorID,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        console.log(`✅ ${role} registered with ID: ${customID}`);
        return { success: true, authToken: customToken, userID: customID };

    } catch (error) {
        console.error("❌ Registration error:", error.message);
        return { success: false, error: error.message };
    }
}

app.post("/register", async (req, res) => {
    try {
        const { creatorID, fullName, role, company, password, registrarName, prevRegistrarID} = req.body;

        if (!creatorID || !fullName || !role || !company) {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        console.log(`📝 Registering user: ${fullName} (Role: ${role}) by Creator: ${creatorID}`);

        const result = await registerUser(creatorID, fullName, role, company, password, registrarName, prevRegistrarID);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.status(201).json(result);
    } catch (error) {
        console.error("❌ Server error during registration:", error.message);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});
// 🟢 LOGIN USER (Generate New Token)
async function loginUser(customID) {
    try {
        console.log(`🔍 Attempting login for user ID: ${customID}`);

        // 🔍 Step 1: Get user details and Firestore path
        const userResult = await getUserRole(customID);
        if (!userResult.success) {
            console.error(`❌ User '${customID}' not found.`);
            return { success: false, error: "User not found" };
        }

        const { fullName, role, prevRegistrarId, userPath } = userResult;;

        if (!userPath) {
            console.error(`❌ User path not found for '${customID}'`);
            return { success: false, error: "User path not found" };
        }

        // 🔍 Step 2: Fetch user data from Firestore using `userPath`
        const userDoc = await db.doc(userPath).get();
        if (!userDoc.exists) {
            console.error(`❌ User document does not exist at path: ${userPath}`);
            return { success: false, error: "User document not found" };
        }

        const userData = userDoc.data();
        console.log(`📜 Retrieved user data:`, userData);

        // 🔥 Step 3: Generate Firebase Custom Token
        const newToken = await admin.auth().createCustomToken(customID);
        console.log(`✅ Firebase custom token generated successfully!`);

        // 🔥 Step 4: Update the user's last login timestamp
        await db.doc(userPath).update({
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ Last login timestamp updated at: ${userPath}`);

        console.log(`🎉 ${role} successfully logged in!`);
        return { success: true, fullName, role, prevRegistrarId, authToken: newToken, userPath: userPath };

    } catch (error) {
        console.error("❌ Login error:", error.message);
        return { success: false, error: error.message };
    }
}

// 🔹 Login Route
app.post("/login", async (req, res) => {
    const { id } = req.body;
    const result = await loginUser(id);

    if (!result.success) {
        return res.status(401).json({ error: result.error });
    }
    console.log("🔑 Custom Token Sent to Frontend:", result.authToken);

    // Send JSON response with token (frontend will handle redirect)
    res.json({ success: true, fullName: result.fullName, authToken: result.authToken , userPath: result.userPath });
});

// 🟢 WELCOME PAGE ROUTE
app.get("/welcome", async (req, res) => {
    const authToken = req.query.token; // Get token from query params
    const userPath = req.query.path; // Get user path from query

    if (!authToken || !userPath) {
        return res.status(401).send("Unauthorized: Missing token or user path");
    }

    try {
        // Verify Firebase Token
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const userID = decodedToken.uid;

        console.log("User ID:",userID);
        // Retrieve user details using the provided userPath
        const userDoc = await db.doc(userPath).get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found");
        }

        const userData = userDoc.data();

        res.render("welcome", { username: userData.fullName, userId: userID }); // Render Pug template
    } catch (error) {
        console.error("❌ Token verification error:", error.message);
        res.status(403).send("Invalid or expired token");
    }
});

async function clockInUser(id, address, comment) {
    try {
        // 🔍 Step 1: Get user role and path
        const userData = await getUserRole(id);
        if (!userData.success) {
            return { success: false, error: userData.error };
        }

        const { fullName, userPath } = userData;
        const clockCollectionRef = db.doc(userPath).collection("clock");
        const lastEventRef = db.doc(userPath).collection("clock").doc("lastEvent"); 
        const lastClockingRef = db.doc(userPath).collection("clock").doc("lastClocking"); 

        // 🔍 Step 2: Get current timestamp and today's start time
        const now = admin.firestore.Timestamp.now();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 🔍 Step 3: Check if a clock-in document exists for today
        const todayClockQuery = await clockCollectionRef
            .where("clockInTime", ">=", admin.firestore.Timestamp.fromDate(todayStart))
            .limit(1)
            .get();

        if (!todayClockQuery.empty) {
            // ✅ Clock-out: Update existing document
            const clockDocRef = todayClockQuery.docs[0].ref;
            await clockDocRef.update({
                clockOutTime: now,
                clockOutLocation: address,
                clockOutComment: comment,
                status: "clocked out",
            });

            // 🔄 Overwrite lastEvent with clock-out details
            await lastEventRef.set({
                type: "clock_out",
                timestamp: now,
                location: address,
                comment: comment,
                status: "clocked out",
            });

            await lastClockingRef.set({
                lastClockInTime: todayClockQuery.docs[0].data().clockInTime,
                lastClockOutTime: now,
                lastClockOutLocation: address,
                lastClockOutComment: comment
            });

            console.log(`✅ Clock-out recorded for ${fullName} at ${address}`);
            return { success: true, message: `Clock-out successful for ${fullName}` };
        } else {
            // ✅ Clock-in: Create a new document
            const clockInData = {
                clockInTime: now,
                clockInLocation: address,
                clockInComment: comment,
                clockOutTime: null,
                clockOutLocation: null,
                clockOutComment: null,
                status: "clocked in",
            };

            await clockCollectionRef.add(clockInData);

            // 🔄 Overwrite lastEvent with clock-in details
            await lastEventRef.set({
                type: "clock_in",
                timestamp: now,
                location: address,
                comment: comment,
                status: "clocked in",
            });

            // 🔄 Overwrite lastClocking with latest clock-in (no clock-out yet)
            await lastClockingRef.set({
                lastClockInTime: now,
                lastClockInLocation: address,
                lastClockInComment: comment,
                lastClockOutTime: null, // No clock-out yet
                lastClockOutLocation: null,
                lastClockOutComment: null
            });

            console.log(`✅ Clock-in recorded for ${fullName} at ${address}`);
            return { success: true, message: `Clock-in successful for ${fullName}` };
        }
    } catch (error) {
        console.error("❌ Error in clock-in process:", error);
        return { success: false, error: error.message };
    }
}


app.post("/clock-in", async (req, res) => {
    try {
        const { userId, address,comments } = req.body;

        // ✅ Validate input
        if (!userId || !address) {
            return res.status(400).json({ success: false, error: "Missing registrarId or address" });
        }

        // ✅ Call the function to log the clock-in
        const result = await clockInUser(userId, address, comments);

        if (!result.success) {
            return res.status(500).json(result); // Send error response
        }

        res.json(result); // Send success response
    } catch (error) {
        console.error("❌ Server error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/get-last-clock-event", async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "User ID is required" });

    try {
        // Get user path based on user ID
        const userRoleData = await getUserRole(userId);
        if (!userRoleData.success) {
            return res.status(404).json({ error: "User not found in any collection." });
        }

        const userPath = userRoleData.userPath; // Firestore document path

        // 🔍 Fetch the last recorded event
        const lastEventRef = db.doc(userPath).collection("clock").doc("lastEvent");
        const lastEventDoc = await lastEventRef.get();

        if (!lastEventDoc.exists) {
            return res.json(null); // No last event found
        }
        console
        res.json(lastEventDoc.data());
    } catch (error) {
        console.error("❌ Error fetching last clock event:", error);
        res.status(500).json({ error: "Database error" });
    }
});

app.post("/get-clock-events", async (req, res) => {
    const { userId } = req.body; // Only userId

    if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
    }

    try {
        const userRoleData = await getUserRole(userId);
        if (!userRoleData.success) {
            return res.status(404).json({ error: "User not found in any collection." });
        }

        const userPath = userRoleData.userPath;
        const snapshot = await db.collection(`${userPath}/clock`)
            .orderBy("clockInTime", "desc") // 🔥 Sort by latest first
            .limit(10)
            .get();

        if (snapshot.empty) {
            return res.json([]);
        }

        const events = snapshot.docs
        .filter(doc => doc.id !== "lastEvent" && doc.id !== "lastClocking") // 🚀 Remove unwanted docs
        .map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                clockInTime: data.clockInTime || null,
                clockInLocation: data.clockInLocation || 'N/A', 
                clockInComment: data.clockInComment || 'N/A',
                clockOutTime: data.clockOutTime || null,
                clockOutLocation: data.clockOutLocation || "N/A",
                clockOutComment: data.clockOutComment || "N/A"
            };
        });
        

        res.json(events);
    } catch (error) {
        console.error("❌ Error fetching clock events:", error);
        res.status(500).json({ error: "Database error" });
    }
});

app.post("/profile", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required" });

        // 🔍 Step 1: Get user role and path
        const userData = await getUserRole(userId);
        if (!userData.success) return res.status(404).json({ error: userData.error });

        const { userPath } = userData;

        // 🔍 Step 2: Get user document (excluding collections)
        const userDocRef = db.doc(userPath);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "User document not found" });
        }

        // 🔍 Step 3: Extract user data (excluding collections)
        let userDetails = userDoc.data();
        delete userDetails.admin; // Remove collections (if needed)
        delete userDetails.clock;

        res.json(userDetails);
    } catch (error) {
        console.error("❌ Error retrieving user profile:", error);
        res.status(500).json({ error: "Server error" });
    }
});

app.post("/get-last-clocking", async (req, res) => {
    const { userId } = req.body; // User ID from frontend

    if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
    }

    try {
        // 🔍 Step 1: Get the user path
        const userRoleData = await getUserRole(userId);
        if (!userRoleData.success) {
            return res.status(404).json({ error: "User not found in any collection." });
        }

        const userPath = userRoleData.userPath;
        const lastClockingRef = db.collection(`${userPath}/clock`).doc("lastClocking");
        const lastClockingDoc = await lastClockingRef.get();

        if (!lastClockingDoc.exists) {
            return res.json({ message: "No last clocking data available." });
        }

                // 🔄 Format response safely
        const data = lastClockingDoc.data();
        const lastClocking = {
            clockInTime: data.clockInTime?._seconds ? new Date(data.clockInTime._seconds * 1000).toISOString() : null,
            clockInLocation: data.clockInLocation || 'N/A',
            clockInComment: data.clockInComment || 'N/A',
            clockOutTime: data.clockOutTime?._seconds ? new Date(data.clockOutTime._seconds * 1000).toISOString() : null,
            clockOutLocation: data.clockOutLocation || "N/A",
            clockOutComment: data.clockOutComment || "N/A",
            status: data.status || "N/A"
        };

        res.json({
            lastClockInTime: data.lastClockInTime ? data.lastClockInTime.toDate() : null,
            lastClockOutTime: data.lastClockOutTime ? data.lastClockOutTime.toDate() : null,
        });
    } catch (error) {
        console.error("❌ Error fetching lastClocking:", error);
        res.status(500).json({ error: "Database error" });
    }
});

async function getUserDataWithSubordinates(userID) {
    try {
        // 🔥 Step 1: Get user role and path
        const { role, fullName, userPath } = await getUserRole(userID);

        if (!role || !userPath) {
            return { success: false, error: "User not found or unauthorized" };
        }

        let subordinates = [];

        if (role === "app owner") {
            // 🔥 Get all admins under this app owner
            const adminsRef = db.doc(userPath).collection("admins");
            const adminsSnapshot = await adminsRef.get();

            if (!adminsSnapshot.empty) {
                subordinates = adminsSnapshot.docs.map(doc => ({
                    uid: doc.id,
                    ...doc.data(),
                    role: "admin",
                }));
            }
        } else if (role === "admin") {
            // 🔥 Get all managers under this admin
            const managersRef = db.doc(userPath).collection("managers");
            const managersSnapshot = await managersRef.get();

            if (!managersSnapshot.empty) {
                subordinates = managersSnapshot.docs.map(doc => ({
                    uid: doc.id,
                    ...doc.data(),
                    role: "manager",
                }));
            }
        } else if (role === "manager") {
            // 🔥 Get all workers under this manager
            const workersRef = db.doc(userPath).collection("workers");
            const workersSnapshot = await workersRef.get();

            if (!workersSnapshot.empty) {
                subordinates = workersSnapshot.docs.map(doc => ({
                    uid: doc.id,
                    ...doc.data(),
                    role: "worker",
                }));
            }
        }

        return {
            success: true,
            user: { uid: userID, fullName, role },
            subordinates,
        };
    } catch (error) {
        console.error("❌ Error fetching user data:", error.message);
        return { success: false, error: error.message };
    }
}

app.post("/getUserDataWithSubordinates", async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: "Missing userID" });
        }
        console.log("User ID for subs:",userId);
        const result = await getUserDataWithSubordinates(userId);

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error("❌ Server error:", error);
        res.status(500).json({ success: false, error: "Internal server error" });
    }
});

app.get("/logout", (req, res) => {
    res.clearCookie("session"); // Clear any backend-stored session cookies
    res.redirect("/login"); // Redirect to login page
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
