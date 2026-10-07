/* ServiceNow Script Include (name: ClassificationEngine, Accessible from: All application scopes)
   Reads the custom table u_classification_rule and returns the best matching rule.
   Call from Flow Designer (Script step / custom Action) or any server script. */
var ClassificationEngine = Class.create();
ClassificationEngine.prototype = {
  initialize: function () {},
  classify: function (shortDesc, desc) {
    var text = ((shortDesc || '') + ' ' + (desc || '')).toLowerCase();
    var gr = new GlideRecord('u_classification_rule');
    gr.addActiveQuery();
    gr.orderBy('u_priority');
    gr.query();
    while (gr.next()) {
      var kw = (gr.getValue('u_keyword') || '').toLowerCase();
      if (kw && text.indexOf(kw) > -1) {
        return { keyword: kw, category: gr.getValue('u_category'), subcategory: gr.getValue('u_subcategory'),
                 priority: gr.getValue('u_priority'), group: gr.getValue('u_assignment_group') /* sys_id */ };
      }
    }
    return null; // no match -> Flow assigns to Service Desk
  },
  type: 'ClassificationEngine'
};
