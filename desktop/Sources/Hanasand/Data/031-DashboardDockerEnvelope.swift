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

struct DashboardDockerEnvelope: Decodable {
    let resolvedContainers: [DashboardDockerContainer]

    enum CodingKeys: String, CodingKey {
        case data
        case containers
    }

    init(from decoder: Decoder) throws {
        if let list = try? [DashboardDockerContainer](from: decoder) {
            resolvedContainers = list
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let list = try? container.decode([DashboardDockerContainer].self, forKey: .data) {
            resolvedContainers = list
        } else if let list = try? container.decode([DashboardDockerContainer].self, forKey: .containers) {
            resolvedContainers = list
        } else {
            resolvedContainers = []
        }
    }
}
