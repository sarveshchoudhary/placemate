// ================= VENUE DATA =================
const venues = [
  { id: "M413", name: "M413", capacity: 50, facilities: "Projector, Whiteboard" },
  { id: "B105", name: "B105", capacity: 30, facilities: "Projector, AC" },
  { id: "M101", name: "M101", capacity: 100, facilities: "Projector, Sound System" },
  { id: "Auditorium", name: "Auditorium", capacity: 300, facilities: "Stage, Sound System, Projector" },
];

// ================= BOOK VENUE (API CALL) =================
async function bookVenue(venueId) {
  const name = prompt("Enter your name:");

  if (!name) {
    alert("Name is required");
    return;
  }

  try {
    const res = await fetch("http://localhost:3002/api/book", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: name,
        service: venueId   // storing venue as service
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed");
    }

    alert("Booking successful!");
    renderBookedVenues(); // refresh UI

  } catch (err) {
    console.error(err);
    alert("Booking failed");
  }
}

// Make function accessible in HTML
window.bookVenue = bookVenue;


// ================= RENDER AVAILABLE VENUES =================
function renderVenues() {
  const venueCards = document.querySelector(".venue-cards");
  if (!venueCards) return;

  venueCards.innerHTML = "";

  venues.forEach((venue) => {
    const card = document.createElement("div");
    card.className = "venue-card";

    card.innerHTML = `
      <h3>${venue.name}</h3>
      <p><strong>Capacity:</strong> ${venue.capacity} students</p>
      <p><strong>Facilities:</strong> ${venue.facilities}</p>
      <button class="btn" onclick="bookVenue('${venue.id}')">Book Now</button>
    `;

    venueCards.appendChild(card);
  });
}


// ================= FETCH & SHOW BOOKINGS =================
async function renderBookedVenues() {
  const bookedCards = document.getElementById("booked-cards");
  if (!bookedCards) return;

  bookedCards.innerHTML = "<p>Loading...</p>";

  try {
    const res = await fetch("http://localhost:3002/api/bookings");
    const bookings = await res.json();

    if (!bookings || bookings.length === 0) {
      bookedCards.innerHTML = "<p>No bookings yet.</p>";
      return;
    }

    bookedCards.innerHTML = "";

    bookings.forEach((booking) => {
      const card = document.createElement("div");
      card.className = "venue-card";

      card.innerHTML = `
        <h3>${booking.service}</h3>
        <p><strong>Name:</strong> ${booking.name}</p>
        <p><strong>Date:</strong> ${new Date(booking.createdAt).toLocaleString()}</p>
      `;

      bookedCards.appendChild(card);
    });

  } catch (err) {
    console.error(err);
    bookedCards.innerHTML = "<p>Error loading bookings</p>";
  }
}


// ================= INIT =================
function init() {
  renderVenues();
  renderBookedVenues();
}

document.addEventListener("DOMContentLoaded", init);