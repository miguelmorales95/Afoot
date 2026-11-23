// Quick test to see what the API returns
const url = "https://afoot.somedude.app/api/events?lat=34.0522&lng=-118.2437&radius=15&days=30";
fetch(url)
  .then(r => r.json())
  .then(data => {
    // Show first event that should be recurring
    const ev = data.events?.find(e => e.is_recurring);
    if (ev) {
      console.log("Sample recurring event:");
      console.log(JSON.stringify(ev, null, 2));
    } else {
      console.log("No recurring events found, showing first event:");
      console.log(JSON.stringify(data.events?.[0], null, 2));
    }
  })
  .catch(e => console.error(e));
