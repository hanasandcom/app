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

struct AIArtifact: Decodable, Equatable {
    let label: String?
    let path: String?
    let content: String?
    let summary: String?

    var displayTitle: String {
        label ?? path ?? "Artifact"
    }

    var displayDetail: String {
        summary ?? path ?? content?.prefix(220).description ?? "File artifact produced by the model."
    }
}
