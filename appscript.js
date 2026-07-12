function doPost(e) {
    try {
        // Connect to the active Google Sheet
        var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

        // The DAISY frontend sends a massive JSON payload as text/plain to avoid CORS
        // We need to parse it from e.postData.contents
        var parsedData = JSON.parse(e.postData.contents);

        var timestamp = new Date().toISOString();
        
        // Extract location from the telemetry data (or fallback)
        var latitude = parsedData.telemetry ? parsedData.telemetry.latitude : "N/A";
        var longitude = parsedData.telemetry ? parsedData.telemetry.longitude : "N/A";
        
        // Count the active threats for the radar columns
        var activeAlerts = parsedData.alerts ? parsedData.alerts.length : 0;
        var rotationPins = parsedData.rotationPins ? parsedData.rotationPins.length : 0;
        
        // Extract the ML probability from our geminiReport field
        var tornadoProbability = parsedData.geminiReport ? parsedData.geminiReport : "Unknown";

        // Append the newly learned metrics as a new row in the Sheet
        // (Columns: Timestamp | Latitude | Longitude | Active Alerts | Rotation Pins | Probability)
        sheet.appendRow([timestamp, latitude, longitude, activeAlerts, rotationPins, tornadoProbability]);

        // Send a success message back to the DAISY frontend
        return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Storm metrics successfully cached." }))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        // Error handling to prevent silent failures
        return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// This function handles the lightweight GET request to check the cache before downloading S3 data
function doGet(e) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();

    // To keep it fast, you can return the sheet data as JSON for the client to parse, 
    // or write logic here to search for the specific timestamp/coordinates requested in e.parameter

    return ContentService.createTextOutput(JSON.stringify({ "status": "active", "total_cached_storms": data.length - 1 }))
        .setMimeType(ContentService.MimeType.JSON);
}