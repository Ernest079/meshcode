# Loads a meshcode-generated GDScript, builds the model, and prints one JSON line describing every
# mesh in scene order: world AABB, triangle count, instance count. Used by test/engines.test.mjs.
# Usage: godot --headless --script validate.gd -- /abs/path/model.gd
extends SceneTree

var holder_script: Script


func _initialize() -> void:
	var path: String = OS.get_cmdline_user_args()[0]
	var script: Script = load(path)
	if script == null or not script.can_instantiate():
		push_error("could not load " + path)
		quit(1)
		return
	holder_script = script
	var holder := Node3D.new()
	holder.set_script(script)
	root.add_child(holder)
	await process_frame # _ready (→ _build) has run by now
	if not holder.has_node("Model"):
		push_error("the script did not build a \"Model\" node")
		quit(1)
		return
	var out: Array = []
	_collect(holder.get_node("Model"), out)
	print("MESHCODE_JSON " + JSON.stringify(out))
	quit()


func _collect(node: Node, out: Array) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		out.append(_entry(mi.name, mi.global_transform * mi.mesh.get_aabb(), mi.mesh.get_faces().size() / 3, 1))
	elif node is MultiMeshInstance3D:
		var mmi := node as MultiMeshInstance3D
		var mm := mmi.multimesh
		# Headless Godot has no rendering server, so MultiMesh keeps no instance data (get_aabb() and
		# get_instance_transform() come back empty). Rebuild each instance from the script's own table,
		# with the same Transform3D formula the generated code uses.
		var rows: Array = holder_script.get_script_constant_map()["D"][mm.resource_name]
		var box := AABB()
		for i in rows.size():
			var t: Array = rows[i]
			var xf := Transform3D(Basis(Quaternion(t[3], t[4], t[5], t[6])) * Basis.from_scale(Vector3(t[7], t[8], t[9])), Vector3(t[0], t[1], t[2]))
			var part := xf * mm.mesh.get_aabb()
			box = part if i == 0 else box.merge(part)
		out.append(_entry(mmi.name, mmi.global_transform * box, mm.mesh.get_faces().size() / 3, mm.instance_count))
	for child in node.get_children():
		_collect(child, out)


func _entry(name: String, box: AABB, triangles: int, instances: int) -> Dictionary:
	return {
		"name": name,
		"min": [box.position.x, box.position.y, box.position.z],
		"max": [box.end.x, box.end.y, box.end.z],
		"triangles": triangles,
		"instances": instances,
	}
