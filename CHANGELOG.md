# Change Log

All notable changes to the "CodeBridge - AI Code Context" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-08-06

### Security
-   **CRITICAL:** Fixed a Path Traversal vulnerability in the file generator. The extension now validates that generated file paths do not escape the target directory.

### Added
-   Added a new setting `useDefaultPrompts` (default: `true`) to allow users to disable the built-in prompts.

### Changed
-   Renamed the extension to "CodeBridge - AI Code Context" for better clarity and professionalism.
-   Overhauled the default prompts to be more professional, specific, and effective.
-   Improved the logic for handling `customPrompts`. Defining any custom prompts now completely replaces the default list, giving users full control.

### Fixed
-   Fixed a bug where default prompts would not be displayed correctly if the user had an empty `customPrompts` object in their settings.
-   Fixed a bug in the glob-to-regex conversion that incorrectly handled dashes.
-   Fixed a bug where files outside the current workspace could be processed incorrectly.
-   Fixed a bug in the file generator's overwrite logic.

### Performance
-   Improved performance of file content formatting by using `Array.join()` instead of string concatenation.
-   Improved performance of binary file detection.
-   Improved performance of the file generator's path detection.

## [1.0.0] - 2025-08-06

### Added
-   Initial public release of CodeBridge.