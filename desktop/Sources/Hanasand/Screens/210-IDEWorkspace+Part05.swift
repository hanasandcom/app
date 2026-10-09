import SwiftUI

extension IDEWorkspace {
    var ideRail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ideRailHeader
                ideRailSearch
                ideRailPalette
                ideRailDrafts
                ideRailMemory
                ideRailProject
                ideRailProblems
                ideRailGit
                ideRailTasks
                ideRailPlugins
                ideRailOutline
                ideRailSnippets
                ideRailSpacer
                ideRailFooter
            }
            .padding(.bottom, 14)
        }
        .background(theme.sidebar.opacity(0.86))
    }
}
