const firebaseConfig = {
    apiKey: "AIzaSyDZu7SD7lk821lKb9HBNVLhGObDkUVZq8I",
    authDomain: "employee-tracker-e67bb.firebaseapp.com",
    projectId: "employee-tracker-e67bb",
    storageBucket: "employee-tracker-e67bb.appspot.com",
    messagingSenderId: "848302077011",
    appId: "1:848302077011:web:c15a8ba659f4e12cefc2a6"
};

let address;
let userId;
let userName;
let bodyHtml;

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); 
}

if (typeof firebase === "undefined") {
    console.error("❌ Firebase is not loaded. Make sure Firebase is included on this page.");
} else {
    console.log("✅ Firebase is loaded correctly.");
}

async function logout() {
    try {
        await firebase.auth().signOut();
        console.log("✅ Firebase user signed out");

        // Clear tokens and session storage
        localStorage.removeItem("firebaseIdToken");
        localStorage.removeItem("userPath");
        sessionStorage.clear();

        // Expire cookies
        document.cookie = "firebaseIdToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;"; 

        // Redirect to login page
        window.location.href = "/"; 
    } catch (error) {
        console.error("❌ Logout error:", error);
    }
}

// ✅ Reusable function for initializing the map and fetching user location
function initMapAndFetchLocation() {
    if (!navigator.geolocation) {
        console.error("❌ Geolocation is not supported by your browser.");
        return;
    }

    // ✅ Initialize Leaflet map
    const map = L.map("map", { attributionControl: false }).setView([0, 0], 2); // Default world view

    // ✅ Load OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "",
    }).addTo(map); // No attribution text

    // ✅ Get user's location
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;

            // Update map to user's location
            map.setView([latitude, longitude], 13);

            // Add marker at user's location
            const marker = L.marker([latitude, longitude])
                .addTo(map)
                .bindPopup("📍 Fetching address...")
                .openPopup();

            // ✅ Convert Lat/Lng to Address using OpenStreetMap API
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
                );
                const data = await response.json();
                console.log("✅ Received data:", data); // 🔥 Debugging log

                if (!data.display_name) {
                    console.warn("⚠️ No address found in response!");
                }
                address = data.display_name || "Address not found";

                // Update popup & location details
                marker.setPopupContent(`📍 ${address}`);
                const locationDetails = document.getElementById("locationInfo");
                if (locationDetails) {
                    locationDetails.textContent = `🏠 ${address}`;
                }
                console.log("✅ User Address:", address);
                userAddress = address;
            } catch (error) {
                console.error("❌ Address fetch error:", error);
                document.getElementById("locationDetails").textContent =
                    "⚠️ Unable to retrieve address.";
            }
        },
        (error) => {
            console.error("❌ Geolocation error:", error.message);
            document.getElementById("locationDetails").textContent =
                "⚠️ Location access denied.";
        }
    );
}

async function updateClockButton() {
    if (!userId) {
        console.error("❌ User ID is missing.");
        return;
    }

    try {
        const response = await fetch(`/get-last-clock-event?userId=${userId}`);
        const lastEvent = await response.json();
        console.log("Last Event:",lastEvent);
        
        const clockInBtn = document.getElementById("clock-in-btn");

        if (!lastEvent || !lastEvent.type || !lastEvent.timestamp) {
            // No previous event, allow clock in
            clockInBtn.textContent = "Clock In";
            clockInBtn.disabled = false;
            return;
        }

        const lastEventType = lastEvent.type; // "clock_in" or "clock_out"
        const lastEventTimestamp = lastEvent.timestamp;
        const lastEventDate = new Date(lastEvent.timestamp._seconds * 1000).toDateString();

        const todayDate = new Date().toDateString();

        console.log("📅 Last Event timestamp:", lastEventTimestamp);
        console.log("📅 Last Event Date:", lastEventDate);
        console.log("📅 Today's Date:", todayDate);

        if (lastEventType === "clock_in" && lastEventDate === todayDate) {
            // If last event was "clock in" today, change button to "Clock Out"
            clockInBtn.textContent = "Clock Out";
            clockInBtn.disabled = false;
        } else if (lastEventType === "clock_out" && lastEventDate === todayDate) {
            // If last event was "clock out" today, disable button
            clockInBtn.textContent = "Clock Out (Completed)";
            clockInBtn.disabled = true;
        } else {
            // Otherwise, allow a new "Clock In" for the next day
            clockInBtn.textContent = "Clock In";
            clockInBtn.disabled = false;
        }
    } catch (error) {
        console.error("❌ Error fetching last clock event:", error);
    }
}

async function clockIn() {
    if (!address || !userId) {
        console.error("❌ Missing address or user ID.");
        return;
    }

    const comments = document.getElementById("clock-comment").value;
    const response = await fetch("/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId, address: address, comments: comments }),
    });

    const result = await response.json();
    console.log(result);
    await updateClockButton();
}


document.getElementById("clock-in-btn").addEventListener("click", () => {
    if (!address) {
        document.getElementById("clock-in-btn").disabled = true; // ✅ Corrected
        console.error("❌ Address not available.");
        return;
    }

    console.log("✅ Address Ready:", address, "UserId:",userId);
    clockIn();
});

async function fetchClockEvents(userId,username) {
    try {
        const response = await fetch("/get-clock-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userId: userId 
            }),
        });

        const events = await response.json();

        console.log("📜 Clock Events:", events);

        if (!Array.isArray(events)) {
            console.error("❌ Invalid response format:", events);
            return;
        }


        events.sort((a, b) => (a.clockInTime?._seconds || 0) - (b.clockInTime?._seconds || 0));
        window.fetchedEvents = events ;

        const container = document.getElementById("right-side");
        container.innerHTML = ""; // Clear old table

        // Create a button for downloading CSV
        const downloadBtn = document.createElement("button");
        downloadBtn.innerText = "Download CSV";
        downloadBtn.onclick = () => downloadCSV(username);
        container.appendChild(downloadBtn);

        const table = document.createElement("table");
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Clock In Time</th>
                    <th>Clock In Location</th>
                    <th>Clock In Comment</th>
                    <th>Clock Out Time</th>
                    <th>Clock Out Location</th>
                    <th>Clock Out Comment</th>
                </tr>
            </thead>
            <tbody id="events-table-body"></tbody>
        `;


        const tbody = table.querySelector("tbody");

        events.forEach(event => {
            const clockInTime = event.clockInTime
                ? new Date(event.clockInTime._seconds * 1000).toLocaleString()
                : "N/A";
        
            const clockOutTime = event.clockOutTime
                ? new Date(event.clockOutTime._seconds * 1000).toLocaleString()
                : "N/A";
        
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${clockInTime}</td>
                <td>${event.clockInLocation}</td>
                <td>${event.clockInComment || "N/A"}</td>
                <td>${clockOutTime}</td>
                <td>${event.clockOutLocation}</td>
                <td>${event.clockOutComment || "N/A"}</td>
            `;
            tbody.appendChild(row);
        });
        

        container.appendChild(table);

        // Save the latest timestamp for the next request
        if (events.length > 0) {
            lastTimestamp = events[events.length - 1].timestamp._seconds * 1000;
        }
    } catch (error) {
        console.error("❌ Error fetching clock events:", error);
    }
}

function downloadCSV(username) {
    if (!window.fetchedEvents || window.fetchedEvents.length === 0) {
        alert("No data to download.");
        return;
    }

    let csvContent = `"Name","Clock In Time","Clock In Location","Clock In Comment","Clock Out Time","Clock Out Location","Clock Out Comment"\n`;

    window.fetchedEvents.forEach(event => {
        let clockInTime = event.clockInTime
            ? new Date(event.clockInTime._seconds * 1000).toLocaleString()
            : "N/A";

        let clockOutTime = event.clockOutTime
            ? new Date(event.clockOutTime._seconds * 1000).toLocaleString()
            : "N/A";

        let row = [
            `"${username}"`,
            `"${clockInTime}"`,
            `"${event.clockInLocation || "N/A"}"`,
            `"${event.clockInComment || "N/A"}"`,
            `"${clockOutTime}"`,
            `"${event.clockOutLocation || "N/A"}"`,
            `"${event.clockOutComment || "N/A"}"`
        ].join(",");

        csvContent += row + "\n";
    });

    // Create a Blob and download it as a file
    const blob = new Blob([csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "clock_events.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}



document.getElementById("myReport").addEventListener("click", fetchClockEvents);

async function fetchUserProfile(userId) {
    try {
        const response = await fetch("/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
        });

        const userData = await response.json();

        if (userData.error) {
            console.error("Error:", userData.error);
            return;
        }

        console.log("✅ User Document:", userData);
        displayUserDocument(userData);
    } catch (error) {
        console.error("❌ Error fetching user document:", error);
    }
}

function displayUserDocument(userData) {
    const container = document.getElementById("right-side");
    container.innerHTML = `
        <div class="profile-card">
            <h2>${userData.fullName || "No Name"}</h2>
            <p><strong>Company:</strong> ${userData.company || "N/A"}</p>
            <p><strong>Email:</strong> ${userData.email || "N/A"}</p>
            <p><strong>Role:</strong> ${userData.role || "Unknown"}</p>
            <p><strong>ID:</strong> ${userData.uid || "Unknown"}</p>
            <p><strong>Last Login:</strong> ${formatTimestamp(userData.lastLogin) || "N/A"}</p>
        </div>
    `;
}

// 🕒 Function to format Firestore Timestamps
function formatTimestamp(timestamp) {
    if (!timestamp || !timestamp._seconds) return "N/A";
    const date = new Date(timestamp._seconds * 1000);
    return date.toLocaleString(); 
}

async function fetchLastClocking(userId) {
    try {
        const response = await fetch("/get-last-clocking", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
        });

        const data = await response.json();

        if (response.ok) {
            const clockIn = data.lastClockInTime ? new Date(data.lastClockInTime) : null;
            const clockOut = data.lastClockOutTime ? new Date(data.lastClockOutTime) : null;

            // 🎯 Format Date and Time Together
            document.getElementById("lastClockIn").textContent = clockIn 
                ? `${clockIn.toLocaleDateString()} ${clockIn.toLocaleTimeString()}` 
                : "N/A";

            document.getElementById("lastClockOut").textContent = clockOut 
                ? `${clockOut.toLocaleDateString()} ${clockOut.toLocaleTimeString()}` 
                : "N/A";
             // 🔄 Update the UI with the fetched data
        } else {
            console.error("❌ Error:", data.error);
        }
    } catch (error) {
        console.error("❌ Error fetching lastClocking:", error);
    }
}

async function fetchUserDataWithSubordinates(userId) {
    try {
        const response = await fetch("/getUserDataWithSubordinates", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ userId }),
        });

        console.log("User ID for subs:",userId);
        const data = await response.json();
        if (!data.success) {
            console.error("Error:", data.error);
            return null;
        }

        data.subordinates = data.subordinates.filter(user => user.fullName);
        console.log("User Data:", data);

        const container = document.getElementById("right-side");
        container.innerHTML = "";

        data.subordinates.forEach(subordinate => {
            // Create main div
            const subDiv = document.createElement("div");
            subDiv.classList.add("subordinate-card");
        
            // Create header with name
            const nameHeader = document.createElement("h3");
            nameHeader.textContent = subordinate.fullName;
            subDiv.appendChild(nameHeader);
        
            // Create a div to group buttons
            const buttonGroup = document.createElement("div");
            buttonGroup.classList.add("button-group"); // ✅ Add class for flexbox
        
            // Create buttons
            const profileBtn = document.createElement("button");
            profileBtn.textContent = "Profile";
            profileBtn.classList.add("profile-btn");
            profileBtn.onclick = () => fetchUserProfile(subordinate.uid);
        
            const reportsBtn = document.createElement("button");
            reportsBtn.textContent = "View Reports";
            reportsBtn.classList.add("reports-btn");
            reportsBtn.onclick = () => fetchClockEvents(subordinate.uid, subordinate.fullName);
        
            const subordinatesBtn = document.createElement("button");
            subordinatesBtn.textContent = "Subordinates";
            subordinatesBtn.classList.add("subordinates-btn");
            subordinatesBtn.onclick = () => fetchUserDataWithSubordinates(subordinate.uid);
        
            // Append buttons to button group
            buttonGroup.appendChild(profileBtn);
            buttonGroup.appendChild(reportsBtn);
            buttonGroup.appendChild(subordinatesBtn);
        
            // Append button group to subDiv
            subDiv.appendChild(buttonGroup);
        
            // Append to container
            container.appendChild(subDiv);
        });        

    } catch (error) {
        console.error("❌ Fetch error:", error);
        return null;
    }
}

document.addEventListener("DOMContentLoaded", function () {
    userId = document.getElementById("user-id").value;
    userName = document.getElementById("name").textContent;

    if (typeof firebase === "undefined") {
        console.error("❌ Firebase is not loaded. Check script paths!");
        return;
    }

    const homeBtn = document.getElementById("home-btn");
    if (homeBtn) {
        homeBtn.addEventListener("click", function () {
            location.hash = "#home";
        });
    } else {
        console.warn("⚠ Home button not found! Check HTML.");
    }

    const logOutBtn = document.getElementById("logOut");
    if (logOutBtn) {
        logOutBtn.addEventListener("click", logout);
    } else {
        console.error("❌ Logout button not found! Check HTML.");
    }

    fetchLastClocking(userId);
    initMapAndFetchLocation();
    updateClockButton();

    setTimeout(() => {
        bodyHtml =  document.body.innerHTML;
    }, 1000); // Allow time for the map to load

    document.getElementById("home-btn").addEventListener("click", () => {
        document.body.innerHTML = bodyHtml;
        fetchLastClocking(userId)
        attachEventListeners();
    });
    
    document.getElementById("myReport").addEventListener("click",()=> fetchClockEvents(userId, userName));
    document.getElementById("profile").addEventListener("click",()=>fetchUserProfile(userId));    
    document.getElementById("subOrds").addEventListener("click",()=> fetchUserDataWithSubordinates(userId));
});


// Function to reattach event listeners
function attachEventListeners() {
    document.getElementById("home-btn")?.addEventListener("click", () => {
        document.body.innerHTML = bodyHtml;
        fetchLastClocking(userId);
        attachEventListeners();
    });

    document.getElementById("logOut")?.addEventListener("click", logout);
    document.getElementById("myReport").addEventListener("click",()=> fetchClockEvents(userId, userName));
    document.getElementById("clock-in-btn").addEventListener("click", () => {
        if (!address) {
            document.getElementById("clock-in-btn").disabled = true; // ✅ Corrected
            console.error("❌ Address not available.");
            return;
        }
    
        console.log("✅ Address Ready:", address, "UserId:",userId);
        clockIn();
    });
    document.getElementById("profile").addEventListener("click",()=>fetchUserProfile(userId));    
    document.getElementById("subOrds").addEventListener("click",()=> fetchUserDataWithSubordinates(userId));

    initMapAndFetchLocation(); // Reinitialize map
    updateClockButton(); // Reinitialize clock
}


