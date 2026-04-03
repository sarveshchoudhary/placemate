// Sample data for VIT Campus classrooms
const classrooms = [
    // A Block (2 floors)
    { id: "A-101", name: "A-101 Lecture Hall", block: "A", floor: "1", type: "classroom", capacity: 80, facilities: ["Projector", "AC"] },
    { id: "A-102", name: "A-102 Classroom", block: "A", floor: "1", type: "classroom", capacity: 60, facilities: ["Projector"] },
    { id: "A-201", name: "A-201 Classroom", block: "A", floor: "2", type: "classroom", capacity: 60, facilities: ["Projector", "AC"] },
    
    // B Block (3 floors)
    { id: "B-101", name: "B-101 Classroom", block: "B", floor: "1", type: "classroom", capacity: 60, facilities: ["Projector"] },
    { id: "B-102", name: "B-102 Seminar Hall", block: "B", floor: "1", type: "seminar", capacity: 120, facilities: ["Projector", "AC", "Sound System"] },
    { id: "B-201", name: "B-201 Classroom", block: "B", floor: "2", type: "classroom", capacity: 60, facilities: ["Projector"] },
    { id: "B-301", name: "B-301 Computer Lab", block: "B", floor: "3", type: "lab", capacity: 40, facilities: ["Computers", "Projector"] },
    
    // C Block (3 floors)
    { id: "C-101", name: "C-101 Classroom", block: "C", floor: "1", type: "classroom", capacity: 60, facilities: ["Projector", "AC"] },
    { id: "C-201", name: "C-201 Classroom", block: "C", floor: "2", type: "classroom", capacity: 60, facilities: ["Projector"] },
    { id: "C-301", name: "C-301 Electronics Lab", block: "C", floor: "3", type: "lab", capacity: 30, facilities: ["Lab Equipment"] },
    
    // D Block (3 floors)
    { id: "D-101", name: "D-101 Classroom", block: "D", floor: "1", type: "classroom", capacity: 60, facilities: ["Projector", "AC"] },
    { id: "D-102", name: "D-102 Seminar Hall", block: "D", floor: "1", type: "seminar", capacity: 150, facilities: ["Projector", "AC", "Stage"] },
    { id: "D-201", name: "D-201 Classroom", block: "D", floor: "2", type: "classroom", capacity: 60, facilities: ["Projector"] },
    
    // L Block (Basement - Labs)
    { id: "L-B01", name: "L-B01 Computer Lab", block: "L", floor: "B", type: "lab", capacity: 40, facilities: ["Computers", "Projector"] },
    { id: "L-B02", name: "L-B02 Networking Lab", block: "L", floor: "B", type: "lab", capacity: 30, facilities: ["Network Equipment"] },
    
    // Special Rooms
    { id: "AUD-01", name: "Main Auditorium", block: "AUD", floor: "G", type: "auditorium", capacity: 500, facilities: ["Stage", "Sound System", "Lighting"] },
    { id: "DEN-01", name: "DEN Playing Room", block: "DEN", floor: "G", type: "special", capacity: 20, facilities: ["Games", "TV"] }
];

// Function to render classrooms
function renderClassrooms(filteredClassrooms = classrooms) {
    const container = document.getElementById("classrooms-container");
    container.innerHTML = "";
    
    if (filteredClassrooms.length === 0) {
        container.innerHTML = `<div class="no-results">No classrooms found matching your criteria</div>`;
        return;
    }
    
    filteredClassrooms.forEach(room => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <h3>${room.name}</h3>
            <p><i class="fas fa-building"></i> Block ${room.block}, Floor ${room.floor}</p>
            <p><i class="fas fa-users"></i> Capacity: ${room.capacity}</p>
            <p><i class="fas fa-tools"></i> ${room.facilities.join(", ")}</p>
            <a href="booking.html?room=${room.id}" class="btn btn-primary">Book Now</a>
        `;
        container.appendChild(card);
    });
}

// Function to apply filters
function applyFilters() {
    const blockFilter = document.getElementById("block").value;
    const floorFilter = document.getElementById("floor").value;
    const typeFilter = document.getElementById("type").value;
    const capacityFilter = parseInt(document.getElementById("capacity").value);
    
    const filtered = classrooms.filter(room => {
        if (blockFilter && room.block !== blockFilter) return false;
        if (floorFilter && room.floor !== floorFilter) return false;
        if (typeFilter && room.type !== typeFilter) return false;
        if (capacityFilter && room.capacity < capacityFilter) return false;
        return true;
    });
    
    renderClassrooms(filtered);
}

// Function to reset filters
function resetFilters() {
    document.getElementById("block").value = "";
    document.getElementById("floor").value = "";
    document.getElementById("type").value = "";
    document.getElementById("capacity").value = "0";
    renderClassrooms();
}

// Initialize the page
document.addEventListener("DOMContentLoaded", () => {
    // Initial render
    renderClassrooms();
    
    // Add event listeners
    document.getElementById("apply-filters").addEventListener("click", applyFilters);
    document.getElementById("reset-filters").addEventListener("click", resetFilters);
});
