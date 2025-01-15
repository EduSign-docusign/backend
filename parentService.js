//parentService.js
const { db, bucket } = require("./firebase");


async function addChild(req, res) {
    try {
        const { parent_id, student_id } = req.body;

        const parentRef = db.collection("users").doc(parent_id)
        const parentDoc = await parentRef.get()
        const parentData = parentDoc.data()
    
        const children = parentData.children || [];
    
        const updatedChildren = children.map(child =>
            child.id === student_id ? { ...child, invite_pending: false } : child
        );
    
        await parentRef.update({ children: updatedChildren });
    
        res.json({ success: true, message: "Invite status updated", children: updatedChildren })
    } catch (error) {
        console.error("Error removing child:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


async function removeChild(req, res) {
    try {
        const { parent_id, student_id } = req.body;

        const parentRef = db.collection("users").doc(parent_id);
        const parentDoc = await parentRef.get();

        if (!parentDoc.exists) {
            return res.status(404).json({ error: "Parent not found" });
        }

        const parentData = parentDoc.data();
        const children = parentData.children || [];

        const updatedChildren = children.filter(child => child.id !== student_id);

        await parentRef.update({ children: updatedChildren });

        res.json({ success: true, message: "Child removed successfully", children: updatedChildren });

    } catch (error) {
        console.error("Error removing child:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
}
    
module.exports = {
    addChild,
    removeChild
}