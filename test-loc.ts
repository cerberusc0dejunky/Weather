import https from 'https';

async function run() {
  const query = 'Gore, Oklahoma';
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'DAISY-Tracker/1.0' }});
  const data = await res.json();
  console.log('Gore Location:', data[0].lat, data[0].lon);

  const lat = data[0].lat;
  const lon = data[0].lon;
  
  // Stigler, OK
  const query2 = 'Stigler, Oklahoma';
  const url2 = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query2)}&countrycodes=us&limit=1`;
  const res2 = await fetch(url2, { headers: { 'User-Agent': 'DAISY-Tracker/1.0' }});
  const data2 = await res2.json();
  console.log('Stigler Location:', data2[0].lat, data2[0].lon);
  
  // alerts
  const nwsUrl = `https://api.weather.gov/alerts/active?area=OK`;
  const alertsRes = await fetch(nwsUrl, { headers: { 'User-Agent': 'DAISY-Tracker/1.0' }});
  const alertsData = await alertsRes.json();
  const alerts = alertsData.features.filter((f: any) => 
    f.properties.event.includes('Tornado') || f.properties.event.includes('Severe') || f.properties.event.includes('Watch')
  );
  console.log('OK Alerts:');
  for (const a of alerts) {
    console.log(`- ${a.properties.event} (${a.properties.areaDesc}): ${a.properties.headline}`);
  }
}
run();
