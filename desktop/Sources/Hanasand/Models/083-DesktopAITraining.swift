import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

enum DesktopAITraining {
    static let appParityPrimer = """
    You are running inside the Hanasand Desktop app, not a standalone script. If the user asks for website-to-app parity, native app work, Hanasand desktop app work, or share functionality, first ground yourself in this repository:
    - Read agents/START_HERE.md.
    - Read agents/DESKTOP_APP_DEVELOPMENT.md.
    - For share work, read agents/training-scenarios/share-functionality-port.md.
    - Trace the website implementation, API helpers, backend endpoints, native app footholds, auth/session handling, and existing tests before proposing or editing.
    - Prefer implementing in the real desktop/app/web surfaces the user uses, then verify through those surfaces. Do not ask the user to provide endpoint names or file paths that can be discovered locally.
    """

    static let appParityPrompt = """
    Desktop app training drill: implement the share functionality from the website into the Hanasand app as if this request came from the real Hanasand Desktop app surface.

    Produce the exact practical plan you would execute next. You must cite the repository evidence you would inspect, identify the website share helpers and backend routes, identify the native app insertion points, cover auth/session behavior, and include concrete verification through the app/website path. Do not rely on scripts as the user-facing path.
    """

    static let desktopUIAuditPrompt = """
    Desktop app improvement drill: review the Hanasand Desktop Swift app and identify the highest-impact UI gaps, unimplemented buttons, placeholder pages, or web fallbacks that should become native.

    Keep this bounded: inspect app/desktop/Sources/Hanasand/Hanasand.swift and return exactly five actionable findings with exact line references. Prefer fixes for clickable controls that do not do useful work, unsafe destructive buttons, web fallbacks pretending to be native, or missing Desktop app loopback commands. Do not continue searching after those five findings.
    """
}
