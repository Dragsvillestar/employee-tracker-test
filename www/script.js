// Ensure Firebase is loaded
// Ensure Firebase SDK is loaded
if (typeof firebase === "undefined") {
    console.error("Firebase SDK not loaded properly.");
}

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDZu7SD7lk821lKb9HBNVLhGObDkUVZq8I",
    authDomain: "employee-tracker-e67bb.firebaseapp.com",
    projectId: "employee-tracker-e67bb",
    storageBucket: "employee-tracker-e67bb.appspot.com",
    messagingSenderId: "848302077011",
    appId: "1:848302077011:web:c15a8ba659f4e12cefc2a6"
};

// ✅ Initialize Firebase if not already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// ✅ Initialize Firebase Authentication
const auth = firebase.auth();

// ✅ Enable authentication persistence (important!)
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .then(() => {
        console.log("Auth persistence set to LOCAL (remains after reload)");
    })
    .catch((error) => {
        console.error("Error setting auth persistence:", error);
    });

// ✅ Listen for authentication state changes
auth.onAuthStateChanged((user) => {
    if (user) {
        console.log("✅ User is signed in:", user);
        document.getElementById("welcome-message").textContent = `Welcome, ${user.displayName || "User"}!`;
    } else {
        console.log("❌ No user signed in.");
    }
});

let creatorID = "";
let signUpRole ="";
let registrarName = "";
let registrarRole = "";

async function checkRole() {
    try {
        const registrarId = document.getElementById("registrarId").value;
        creatorID = registrarId;
        console.log("🔍 Checking role for ID:", registrarId); // Debugging

        if (!registrarId) {
            document.getElementById("checkRole-errorMsg").innerText = "Please enter a valid ID";
            return;
        }

        const response = await fetch("/checkRole", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ registrarId }),
        });

        console.log("registrarid:",registrarId)
        const data = await response.json();

        if (!data.success) {
            console.error("❌ Error fetching role:", data.error);
            document.getElementById("checkRole-errorMsg").innerText = data.error;
            return null;
        }

        console.log(`✅ Role: ${data.role}, Name: ${data.fullName}`);
        document.getElementById("checkroleDiv").style.display = "none";
        document.getElementById("checkResultDiv").style.display = "block";
        document.getElementById("checkName").textContent = data.fullName.toUpperCase();
        document.getElementById("checkRole").textContent = data.role.toUpperCase();
        
        registrarRole = data.role;
        registrarName = data.fullName.toUpperCase();

        if (data.role === "admin") {
            document.getElementById("adminOpt").remove();
        }
        
        if (data.role === "manager") {
            document.getElementById("adminOpt").remove();
            document.getElementById("managerOpt").remove();
        }

        if (data.role === "worker") {
            document.getElementById("levelDiv").innerHTML = '<p class="fw-bold text-muted text-center">Base workers are not allowed to register anyone</p>';
        }        
 
        return data;
    } catch (error) {
        console.error("❌ Network error:", error.message);
        document.getElementById("checkRole-errorMsg").innerText = error.message;
        return null;
    }
}

/*function levelSelect() {
    const level = document.getElementById("reg-select").value;
    signUpRole = level;
    document.getElementById("checkResultDiv").style.display = "none";
    document.getElementById("reg-form").style.display = "block";

    const supervisorField = document.getElementById("supervisorId");
    const levelDiv = document.getElementById("levelDiv");
    if (level === "worker") {
        levelDiv.textContent = "Workers are not allowed to register anyone";  
    }
}*/

// 🔹 LOGIN FUNCTION
const login = async () => {
    const customID = document.getElementById("login-id").value.trim();
    const errorMessage = document.getElementById("error-message");

    try {
        const response = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: customID })
        });

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || "Login failed");
        }

        console.log("🔥 Received Firebase Custom Token:", data.authToken);
        console.log("✅ Login successful:", data);
        errorMessage.textContent = "Logging in...";

        // Log in using Firebase Custom Token
        firebaseLogin(data.authToken, data.userPath);
    } catch (error) {
        console.error("❌ Login error:", error.message);
        errorMessage.textContent = error.message;
    }
};

// 🔹 FIREBASE LOGIN FUNCTION (Using Custom Token)
async function firebaseLogin(customToken, path) {
    try {
        // Exchange custom token for Firebase ID token
        const userCredential = await auth.signInWithCustomToken(customToken);
        const user = userCredential.user;

        console.log("User:", user);

        // Get ID token (this is what you need for authentication)
        const idToken = await user.getIdToken();
        console.log("🔥 Firebase Login Success:", user);
        console.log("🔑 ID Token:", idToken);

        // Store ID token in localStorage
        localStorage.setItem("firebaseIdToken", idToken);

        // Redirect to welcome page with the ID token
        window.location.href = `/welcome?token=${idToken}&path=${encodeURIComponent(path)}`;
    } catch (error) {
        console.error("❌ Firebase Login Error:", error.message);
        alert("Firebase Login Error: " + error.message);
    }
}

