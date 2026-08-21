#include <iostream>
#include <vector>
#include <stdexcept>
#include <fstream>
#include <memory>
#include <cstring>
#include <tesseract/baseapi.h>
#include <leptonica/allheaders.h>
#include <chrono>
#include <windows.h>
#include <shellscalingapi.h>
#pragma comment(lib, "Shcore.lib")
#include <thread>
#include <stdio.h>
#include <algorithm>
#include <regex>
#include <string>
#include <nlohmann/json.hpp>

using namespace std;
using json = nlohmann::json;

// Configurable border color (can be overridden via command line arguments)
static short borderColorRed = 82;
static short borderColorGreen = 89;
static short borderColorBlue = 90;

// Pre-compiled regex patterns for performance
static const std::regex regexNewlineCRLF("\r\n");
static const std::regex regexNewlineLF("\n");
static const std::regex regexAtSymbol("@");

// Cached desktop DC (optimization #2)
static HDC cachedDesktopDC = NULL;
static HWND cachedDesktopWindow = NULL;

// Pixel buffer cache for batch reading (optimization #1)
struct PixelBuffer {
	vector<uint8_t> pixels;
	int x, y, width, height;
	int bytesPerPixel;
	int bytesPerScanLine;
	
	PixelBuffer() : x(0), y(0), width(0), height(0), bytesPerPixel(4), bytesPerScanLine(0) {}
};

static PixelBuffer cachedPixelBuffer;

class Image
{
private:
	vector<uint8_t> Pixels;
	uint32_t width, height;
	uint16_t BitsPerPixel;

	void Flip(void* In, void* Out, int width, int height, unsigned int Bpp);

public:
	explicit Image(HDC DC, int X, int Y, int Width, int Height);

	inline uint16_t GetBitsPerPixel() { return this->BitsPerPixel; }
	inline uint16_t GetBytesPerPixel() { return this->BitsPerPixel / 8; }
	inline uint16_t GetBytesPerScanLine() { return (this->BitsPerPixel / 8) * this->width; }
	inline int GetWidth() const { return this->width; }
	inline int GetHeight() const { return this->height; }
	inline const uint8_t* GetPixels() { return this->Pixels.data(); }
};

void Image::Flip(void* In, void* Out, int width, int height, unsigned int Bpp)
{
	unsigned long Chunk = (Bpp > 24 ? width * 4 : width * 3 + width % 4);
	unsigned char* Destination = static_cast<unsigned char*>(Out);
	unsigned char* Source = static_cast<unsigned char*>(In) + Chunk * (height - 1);

	while (Source != In)
	{
		memcpy(Destination, Source, Chunk);
		Destination += Chunk;
		Source -= Chunk;
	}
}

Image::Image(HDC DC, int X, int Y, int Width, int Height) : Pixels(), width(Width), height(Height), BitsPerPixel(32)
{
	BITMAP Bmp = { 0 };
	HBITMAP hBmp = reinterpret_cast<HBITMAP>(GetCurrentObject(DC, OBJ_BITMAP));

	if (GetObject(hBmp, sizeof(BITMAP), &Bmp) == 0)
		throw runtime_error("BITMAP DC NOT FOUND.");

	RECT area = { X, Y, X + Width, Y + Height };
	HWND Window = WindowFromDC(DC);
	GetClientRect(Window, &area);

	HDC MemDC = GetDC(nullptr);
	HDC SDC = CreateCompatibleDC(MemDC);
	HBITMAP hSBmp = CreateCompatibleBitmap(MemDC, width, height);
	DeleteObject(SelectObject(SDC, hSBmp));

	BitBlt(SDC, 0, 0, width, height, DC, X, Y, SRCCOPY);
	unsigned int data_size = ((width * BitsPerPixel + 31) / 32) * 4 * height;
	vector<uint8_t> Data(data_size);
	this->Pixels.resize(data_size);

	BITMAPINFO Info = { sizeof(BITMAPINFOHEADER), static_cast<long>(width), static_cast<long>(height), 1, BitsPerPixel, BI_RGB, data_size, 0, 0, 0, 0 };
	GetDIBits(SDC, hSBmp, 0, height, &Data[0], &Info, DIB_RGB_COLORS);
	this->Flip(&Data[0], &Pixels[0], width, height, BitsPerPixel);

	DeleteDC(SDC);
	DeleteObject(hSBmp);
	ReleaseDC(nullptr, MemDC);
}

static bool pixelIsBorderColor(short& red, short& green, short& blue) {
	if (red == borderColorRed && green == borderColorGreen && blue == borderColorBlue) {
		return true;
	}

	return false;
}

// Capture a pixel region to buffer for fast access (optimization #1)
static bool capturePixelRegion(HDC dc, int x, int y, int width, int height, bool forceRecapture = false) {
	// Check if we need to recapture (only skip if same region and not forced)
	if (!forceRecapture && cachedPixelBuffer.x == x && cachedPixelBuffer.y == y && 
		cachedPixelBuffer.width == width && cachedPixelBuffer.height == height &&
		!cachedPixelBuffer.pixels.empty()) {
		return true; // Already have this region cached
	}

	cachedPixelBuffer.x = x;
	cachedPixelBuffer.y = y;
	cachedPixelBuffer.width = width;
	cachedPixelBuffer.height = height;
	cachedPixelBuffer.bytesPerPixel = 4; // 32-bit RGB
	cachedPixelBuffer.bytesPerScanLine = ((width * 32 + 31) / 32) * 4;

	unsigned int data_size = cachedPixelBuffer.bytesPerScanLine * height;
	cachedPixelBuffer.pixels.resize(data_size);

	HDC MemDC = GetDC(nullptr);
	if (MemDC == NULL) {
		cerr << "ERROR: Failed to get memory device context" << endl;
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	HDC SDC = CreateCompatibleDC(MemDC);
	if (SDC == NULL) {
		cerr << "ERROR: Failed to create compatible DC" << endl;
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	HBITMAP hSBmp = CreateCompatibleBitmap(MemDC, width, height);
	if (hSBmp == NULL) {
		cerr << "ERROR: Failed to create compatible bitmap" << endl;
		DeleteDC(SDC);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	DeleteObject(SelectObject(SDC, hSBmp));

	if (!BitBlt(SDC, 0, 0, width, height, dc, x, y, SRCCOPY)) {
		cerr << "ERROR: BitBlt failed during pixel capture" << endl;
		DeleteDC(SDC);
		DeleteObject(hSBmp);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	BITMAPINFO Info = { sizeof(BITMAPINFOHEADER), static_cast<long>(width), static_cast<long>(height), 1, 32, BI_RGB, data_size, 0, 0, 0, 0 };
	if (GetDIBits(SDC, hSBmp, 0, height, cachedPixelBuffer.pixels.data(), &Info, DIB_RGB_COLORS) == 0) {
		cerr << "ERROR: GetDIBits failed during pixel capture" << endl;
		DeleteDC(SDC);
		DeleteObject(hSBmp);
		ReleaseDC(nullptr, MemDC);
		cachedPixelBuffer.pixels.clear();
		return false;
	}

	// Flip the image (Windows bitmaps are bottom-up)
	unsigned long Chunk = cachedPixelBuffer.bytesPerScanLine;
	vector<uint8_t> flipped(data_size);
	unsigned char* Destination = flipped.data();
	unsigned char* Source = cachedPixelBuffer.pixels.data() + Chunk * (height - 1);

	while (Source >= cachedPixelBuffer.pixels.data()) {
		memcpy(Destination, Source, Chunk);
		Destination += Chunk;
		Source -= Chunk;
	}
	cachedPixelBuffer.pixels = std::move(flipped);

	DeleteDC(SDC);
	DeleteObject(hSBmp);
	ReleaseDC(nullptr, MemDC);
	return true;
}

// Read pixel from cached buffer (optimization #1)
static bool getPixelFromBuffer(int x, int y, short& red, short& green, short& blue) {
	// Check if pixel is within cached region
	int relX = x - cachedPixelBuffer.x;
	int relY = y - cachedPixelBuffer.y;

	if (relX < 0 || relY < 0 || relX >= cachedPixelBuffer.width || relY >= cachedPixelBuffer.height) {
		return false; // Pixel not in cached region
	}

	// Calculate offset in buffer (BGRA format, bottom-up was flipped to top-down)
	int offset = (relY * cachedPixelBuffer.bytesPerScanLine) + (relX * cachedPixelBuffer.bytesPerPixel);
	
	if (offset + 2 >= static_cast<int>(cachedPixelBuffer.pixels.size())) {
		return false;
	}

	// Windows DIB is BGRA format
	blue = cachedPixelBuffer.pixels[offset];
	green = cachedPixelBuffer.pixels[offset + 1];
	red = cachedPixelBuffer.pixels[offset + 2];

	return true;
}

static bool pixelIsValid(short startingX, short startingY, short& red, short& green, short& blue, short offsetX = 0, short offsetY = 0) {
	LONG x = startingX + offsetX;
	LONG y = startingY + offsetY;

	// Try to read from cached buffer first
	if (getPixelFromBuffer(x, y, red, green, blue)) {
		return pixelIsBorderColor(red, green, blue);
	}

	// Fallback to GetPixel if not in cache (shouldn't happen with proper caching)
	if (cachedDesktopDC) {
		COLORREF color = GetPixel(cachedDesktopDC, x, y);
		if (color == CLR_INVALID) {
			// GetPixel failed - could be due to hardware acceleration or other issues
			return false;
		}
		red = GetRValue(color);
		green = GetGValue(color);
		blue = GetBValue(color);
		return pixelIsBorderColor(red, green, blue);
	}

	return false;
}

static void getBottomRightBorderPoint(short startingX, short startingY, short& red, short& green, short& blue, short& offsetX, short checkRange) {
	offsetX += checkRange;

	while (pixelIsValid(startingX, startingY, red, green, blue, offsetX)) {
		offsetX += checkRange;
	}

	offsetX -= checkRange;
}

static void getTopLeftBorderPoint(short startingX, short startingY, short& red, short& green, short& blue, short& offsetY, short checkRange) {
	offsetY += checkRange;

	while (pixelIsValid(startingX, startingY, red, green, blue, 0, offsetY)) {
		offsetY += checkRange;
	}

	offsetY -= checkRange;
}

static std::string scanForText(tesseract::TessBaseAPI& tess, int x1, int y1, int width, int height) {
	std::string result;

	if (!cachedDesktopDC) {
		return result;
	}

	// Capture the image
	Image img(cachedDesktopDC, x1, y1, width, height);

	tess.SetImage(img.GetPixels(), img.GetWidth(), img.GetHeight(),
		img.GetBytesPerPixel(), img.GetBytesPerScanLine());

	char* utf8 = tess.GetUTF8Text();
	if (utf8) {
		result.assign(utf8);
		delete[] utf8;
	}

	return result;
}

static void rtrim(std::string& s) {
	// Define the characters to trim (common whitespaces)
	const std::string whitespaces = " \t\n\r\f\v";

	// Find the position of the last non-whitespace character
	size_t last_non_space = s.find_last_not_of(whitespaces);

	// If a non-whitespace character is found, resize the string to end just after it
	if (last_non_space != std::string::npos) {
		s.erase(last_non_space + 1);
	}
	else {
		// If the string contains only whitespace (or is empty), clear it
		s.clear();
	}
}

int main(int argc, char* argv[])
{
	// Set DPI awareness to ensure cursor coordinates match actual screen pixels
	SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);

	// Parse optional command line arguments for border color: red green blue
	if (argc >= 4) {
		try {
			borderColorRed = static_cast<short>(std::stoi(argv[1]));
			borderColorGreen = static_cast<short>(std::stoi(argv[2]));
			borderColorBlue = static_cast<short>(std::stoi(argv[3]));
		}
		catch (const std::exception& e) {
			std::cerr << "Error parsing color arguments. Using default values." << std::endl;
		}
	}

	short CURSOR_TOOLTIP_OFFSET_X{};
	short CURSOR_TOOLTIP_OFFSET_Y{};

	WCHAR exe_path[MAX_PATH];
	GetModuleFileNameW(NULL, exe_path, MAX_PATH);

	// 2. Extract the directory path
	std::wstring ws_exe_path(exe_path);
	std::wstring exe_dir = ws_exe_path.substr(0, ws_exe_path.find_last_of(L"\\/"));

	std::ifstream file(exe_dir + L"\\scanningConfig.json");

	// Check if the file opened successfully
	if (!file.is_open()) {
		cout << "IGNORE||NO CONFIG FILE FOUND" << endl;
		CURSOR_TOOLTIP_OFFSET_X = 13;
		CURSOR_TOOLTIP_OFFSET_Y = -13;
		//return 0;
	}
	else
	{
		cout << "IGNORE||CONFIG FILE FOUND" << endl;
		// Parse the JSON data directly from the input stream
		json data = json::parse(file);

		// Close the file (optional, as the ifstream destructor does this automatically)
		file.close();

		CURSOR_TOOLTIP_OFFSET_X = data["offsetX"];
		CURSOR_TOOLTIP_OFFSET_Y = data["offsetY"];
	}

	// Initialize cached desktop DC (optimization #2)
	cachedDesktopWindow = GetDesktopWindow();
	cachedDesktopDC = GetDC(cachedDesktopWindow);
	if (!cachedDesktopDC) {
		cerr << "Failed to get desktop DC" << endl;
		exit(1);
	}

	tesseract::TessBaseAPI tess;
	if (tess.Init(NULL, "eng") != 0) {
		// Init failed
		tess.End();
		ReleaseDC(cachedDesktopWindow, cachedDesktopDC);
		exit(1);
	}

	// Optimize Tesseract settings for speed (optimization #3)
	tess.SetPageSegMode(tesseract::PSM_SINGLE_BLOCK); // Faster than default
	tess.SetVariable("tessedit_char_whitelist", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,$€₽@- "); // Common characters
	tess.SetVariable("classify_bln_numeric_mode", "1"); // Enable numeric mode for faster processing
	// Track last scanned cursor position - only scan once per position
	static POINT lastScannedCursor = {0, 0};

	string scanText{};
	short checkRange = 50;
	short red = 0;
	short green = 0;
	short blue = 0;
	POINT mousePos{};
	POINT lastValidMousePos{};
	POINT bottomLeftBorderPoint{};
	LONG width = 0;
	LONG height = 0;
	short offsetX = 0;
	short offsetY = 0;
	POINT bottomRightBorderPoint{};
	POINT topLeftBorderPoint{};
	//bool mouseIsStationary = false;
	short mouseStationaryCount = 0;
	bool foundTooltip = false;
	bool borderIsVisible = false;
	bool showedMouseMoved = false;

	short horizontalCheckpoints[3] = { 50, 15, 5 };
	short verticalCheckpoints[3] = { -15, -5, -2 };
	// Negative steps: walk left along the bottom border to the true corner
	short leftwardCheckpoints[4] = { -50, -15, -5, -1 };
	
	// Optimized polling loop (optimization #7)
	int sleepInterval = 25; // Default sleep interval
	
	while (true) {
		if (GetCursorPos(&mousePos)) {
			if (lastValidMousePos.x == mousePos.x && lastValidMousePos.y == mousePos.y) {
				if (mouseStationaryCount < 1000) mouseStationaryCount++; // capped: a short would wrap after ~13 min
				// Normal interval when stationary; after ~2s with nothing found
				// (e.g. the cursor locked at screen centre for a whole raid) back
				// off to 100ms so the screen capture runs 10x/s instead of 40x/s.
				// Any mouse movement resets this, so hover latency is unaffected.
				sleepInterval = (mouseStationaryCount > 80 && !foundTooltip) ? 100 : 25;
			}
			else
			{
				if (showedMouseMoved == false) {
					cout << "MOUSEMOVE" << endl;
					fflush(stdout);
					showedMouseMoved = true;
				}
				mouseStationaryCount = 0;
				foundTooltip = false;
				sleepInterval = 50; // Longer interval when moving (optimization #7)
				cachedPixelBuffer.pixels.clear(); // Clear pixel cache
				lastScannedCursor = {0, 0}; // Reset last scanned cursor position
			}

			bottomLeftBorderPoint.x = mousePos.x + CURSOR_TOOLTIP_OFFSET_X;
			bottomLeftBorderPoint.y = mousePos.y + CURSOR_TOOLTIP_OFFSET_Y;

			// Check if we've already scanned this cursor position
			bool alreadyScanned = (mousePos.x == lastScannedCursor.x && mousePos.y == lastScannedCursor.y);
			
			// Only try to detect and scan tooltip if we haven't scanned this cursor position yet
			if (mouseStationaryCount > 2 && !foundTooltip && !alreadyScanned) {
				// Capture a larger region around the expected tooltip area for batch pixel reading (optimization #1)
				// Increased size to ensure we cover all border detection pixels
				int captureX = bottomLeftBorderPoint.x - 100;
				int captureY = bottomLeftBorderPoint.y - 200;
				int captureWidth = 600;
				int captureHeight = 300;
				
				// Ensure coordinates are valid
				if (captureX < 0) captureX = 0;
				if (captureY < 0) captureY = 0;
				
				// Force recapture to ensure fresh pixel data
				capturePixelRegion(cachedDesktopDC, captureX, captureY, captureWidth, captureHeight, true);

				if (pixelIsValid(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue)) {
					borderIsVisible = true;
				}
				// Check the pixel to the top right of the config one
				else if (pixelIsValid(bottomLeftBorderPoint.x + 1, bottomLeftBorderPoint.y - 1, red, green, blue)) {
					bottomLeftBorderPoint.x++;
					bottomLeftBorderPoint.y--;
					borderIsVisible = true;
				}
				// Check the pixel to the bottom left of the config one
				else if (pixelIsValid(bottomLeftBorderPoint.x - 1, bottomLeftBorderPoint.y + 1, red, green, blue)) {
					bottomLeftBorderPoint.x--;
					bottomLeftBorderPoint.y++;
					borderIsVisible = true;
				}

				if (borderIsVisible) {
					borderIsVisible = false;
					offsetX = 0;
					offsetY = 0;
					//cout << bottomLeftBorderPoint.x << ',' << bottomLeftBorderPoint.y << endl;

					foundTooltip = true;

					// Near the right edge of the screen the game shifts its tooltip
					// left to keep it on-screen, so the calibrated point lands somewhere
					// along the bottom border rather than on the bottom-left corner.
					// Walk left along the border to find the real corner first; the
					// one-off wider capture gives that walk pixel data to read from.
					{
						int wideX = bottomLeftBorderPoint.x - 900;
						int wideY = bottomLeftBorderPoint.y - 200;
						if (wideX < 0) wideX = 0;
						if (wideY < 0) wideY = 0;
						capturePixelRegion(cachedDesktopDC, wideX, wideY, 1500, 300, true);

						short leftOffset = 0;
						for (short step : leftwardCheckpoints) {
							getBottomRightBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, leftOffset, step);
						}
						bottomLeftBorderPoint.x += leftOffset; // leftOffset <= 0
					}

					for (short i = 0; i < std::size(horizontalCheckpoints); i++) {
						checkRange = horizontalCheckpoints[i];
						getBottomRightBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, offsetX, checkRange);
					}

					bottomRightBorderPoint.x = bottomLeftBorderPoint.x + offsetX;
					bottomRightBorderPoint.y = bottomLeftBorderPoint.y;

					for (short i = 0; i < std::size(verticalCheckpoints); i++) {
						checkRange = verticalCheckpoints[i];
						getTopLeftBorderPoint(bottomLeftBorderPoint.x, bottomLeftBorderPoint.y, red, green, blue, offsetY, checkRange);
					}

					topLeftBorderPoint.x = bottomLeftBorderPoint.x;
					topLeftBorderPoint.y = bottomLeftBorderPoint.y + offsetY;

					//cout << topLeftBorderPoint.x << ',' << topLeftBorderPoint.y << "|" << bottomRightBorderPoint.x << ',' << bottomRightBorderPoint.y << endl;

					width = bottomRightBorderPoint.x - bottomLeftBorderPoint.x;
					height = bottomLeftBorderPoint.y - topLeftBorderPoint.y;
					//cout << "Width: " << width << ", Height: " << height << ", Offset X: " << offsetX << ", Offset Y: " << offsetY << endl;

					if (width > 10 && height > 10) {
						// Perform OCR (only once per cursor position)
						scanText = scanForText(tess, topLeftBorderPoint.x + 1, topLeftBorderPoint.y + 1, width, height);
						
						// Apply regex replacements using pre-compiled patterns (optimization #6)
						scanText = regex_replace(scanText, regexNewlineCRLF, " ");
						scanText = regex_replace(scanText, regexNewlineLF, " ");
						scanText = regex_replace(scanText, regexAtSymbol, "0");
						
						// Mark this cursor position as scanned
						if (scanText.length() > 3) {
							lastScannedCursor = mousePos;
							rtrim(scanText);
							cout << scanText << "||" << mousePos.x << "," << mousePos.y << endl;
							fflush(stdout);
							showedMouseMoved = false;
						}
					}
				}
			}

			lastValidMousePos = mousePos;
		}

		std::this_thread::sleep_for(std::chrono::milliseconds(sleepInterval));
	}

	tess.End();
	ReleaseDC(cachedDesktopWindow, cachedDesktopDC);
	return 0;
}